/**
 * Loads the built extension into Chromium and drives the browser tools against the fixture page,
 * the same way the side panel, MCP and ACP callers do (a `tool/call` message to the service worker).
 *
 * Build first (`npm run build`). Browser: Playwright's Chromium by default; set
 * NOVA_E2E_CHANNEL=msedge (or chrome-beta, …) to use an installed one that allows --load-extension.
 */
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedEnv } from './cleanup';
import type { ToolResult } from '@datalabrotterdam/nova-ai-browser-protocol';
// @ts-expect-error plain ESM helper without types
import { serveFixtures } from '../serve-fixtures.mjs';

const EXTENSION = fileURLToPath(new URL('../../packages/extension/dist', import.meta.url));

let context: BrowserContext;
let server: Server;
let panel: Page;
let page: Page;
let tabId: number;
let base: string;

async function tool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    return panel.evaluate(([n, a]) => chrome.runtime.sendMessage({ type: 'tool/call', name: n, args: a, caller: 'debug' }), [name, args] as const);
}

function text(result: ToolResult): string {
    return result.content.map((block) => block.type === 'text' ? block.text : '').join('\n');
}

function refFor(tree: string, pattern: RegExp): string {
    const line = tree.split('\n').find((l) => pattern.test(l));
    const ref = line?.match(/\[(ref_\d+)\]/)?.[1];
    if (!ref) throw new Error(`No ref for ${pattern} in:\n${tree}`);
    return ref;
}

test.beforeAll(async () => {
    server = await serveFixtures(0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    context = await chromium.launchPersistentContext('', {
        // Never touch the user's real Nova AI Browser host files (see cleanup.ts).
        env: isolatedEnv(mkdtempSync(join(tmpdir(), 'nova-'))),
        channel: process.env.NOVA_E2E_CHANNEL || 'chromium',
        headless: process.env.NOVA_E2E_HEADED ? false : true,
        // No viewport emulation: Nova runs in real windows, where the captured surface equals the viewport.
        viewport: null,
        args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, '--window-size=1280,900']
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;

    panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    page = await context.newPage();
    await page.goto(`${base}/index.html`);
    await page.bringToFront();

    const context0 = JSON.parse(text(await tool('tabs_context'))) as { tabs: Array<{ tabId: number; url: string }> };
    const fixtureTab = context0.tabs.find((tab) => tab.url.startsWith(base));
    expect(fixtureTab, 'fixture tab joins the Nova group').toBeTruthy();
    tabId = fixtureTab!.tabId;
});

test.afterAll(async () => {
    await context?.close();
    server?.close();
});

test('read_page lists controls with refs and redacts passwords', async () => {
    const tree = text(await tool('read_page', { tabId }));
    expect(tree).toMatch(/button "Increment" \[ref_\d+\]/);
    expect(tree).toMatch(/textbox "Your name" \[ref_\d+\]/);
    expect(tree).toMatch(/combobox "Color" \[ref_\d+\] selected="Red"/);
    expect(tree).toMatch(/generic "Div button" \[ref_\d+\]/);
    expect(tree).toMatch(/button "Inner frame button" \[ref_\d+\]/);
    expect(tree).not.toContain('hunter2');
    expect(tree).toContain('value=[redacted]');
});

test('click by ref fires a real click and shows the cursor', async () => {
    const ref = refFor(text(await tool('read_page', { tabId })), /button "Increment"/);
    const result = await tool('computer', { tabId, action: 'left_click', ref });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('Clicked button "Increment"');
    await expect(page.locator('#count')).toHaveText('1');
    await expect(page.locator('#nova-ai-overlay-host')).toHaveCount(1);
});

test('screenshot coordinates map back to CSS pixels', async () => {
    const shot = await tool('computer', { tabId, action: 'screenshot' });
    const image = shot.content.find((block) => block.type === 'image');
    expect(image).toBeTruthy();
    const [, w, h] = text(shot).match(/Image is (\d+)x(\d+)px/)!;

    const box = (await page.locator('#increment').boundingBox())!;
    const viewport = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const x = (box.x + box.width / 2) * Number(w) / viewport.w;
    const y = (box.y + box.height / 2) * Number(h) / viewport.h;
    await tool('computer', { tabId, action: 'left_click', coordinate: [x, y] });
    await expect(page.locator('#count')).toHaveText('2');
});

test('type, key and form_input fill fields', async () => {
    const tree = text(await tool('read_page', { tabId }));
    await tool('computer', { tabId, action: 'left_click', ref: refFor(tree, /textbox "Your name"/) });
    await tool('computer', { tabId, action: 'type', text: 'Ada' });
    await expect(page.locator('#name')).toHaveValue('Ada');

    await tool('computer', { tabId, action: 'key', text: 'ctrl+a' });
    await tool('computer', { tabId, action: 'type', text: 'Grace' });
    await expect(page.locator('#name')).toHaveValue('Grace');

    expect(text(await tool('form_input', { tabId, ref: refFor(tree, /combobox "Color"/), value: 'Blue' }))).toContain('Blue');
    await expect(page.locator('#color')).toHaveValue('b');
    await tool('form_input', { tabId, ref: refFor(tree, /checkbox "I agree"/), value: true });
    await expect(page.locator('#agree')).toBeChecked();

    const denied = await tool('form_input', { tabId, ref: refFor(tree, /textbox "Password"/), value: 'x' });
    expect(denied.isError).toBe(true);
});

test('hover opens a CSS hover menu', async () => {
    await page.locator('#hover-zone').scrollIntoViewIfNeeded();
    const box = (await page.locator('#hover-zone').boundingBox())!;
    const shot = await tool('computer', { tabId, action: 'screenshot' });
    const [, w] = text(shot).match(/Image is (\d+)x(\d+)px/)!;
    const scale = Number(w) / (await page.evaluate(() => window.innerWidth));
    await tool('computer', { tabId, action: 'hover', coordinate: [(box.x + 20) * scale, (box.y + box.height / 2) * scale] });
    await expect(page.locator('#menu')).toBeVisible();
});

test('drag moves an element', async () => {
    await page.locator('#drag-area').scrollIntoViewIfNeeded();
    const before = (await page.locator('#box').boundingBox())!;
    const shot = await tool('computer', { tabId, action: 'screenshot' });
    const [, w] = text(shot).match(/Image is (\d+)x(\d+)px/)!;
    const scale = Number(w) / (await page.evaluate(() => window.innerWidth));
    const from = [(before.x + 30) * scale, (before.y + 30) * scale];
    const to = [(before.x + 230) * scale, (before.y + 30) * scale];
    await tool('computer', { tabId, action: 'left_click_drag', start_coordinate: from, coordinate: to });
    const after = (await page.locator('#box').boundingBox())!;
    expect(after.x - before.x).toBeGreaterThan(150);
});

test('covered elements are reported instead of misclicked', async () => {
    const ref = refFor(text(await tool('read_page', { tabId })), /button "Covered button"/);
    const result = await tool('computer', { tabId, action: 'left_click', ref });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/covered by/);
});

test('same-origin iframe elements are clickable by ref', async () => {
    const ref = refFor(text(await tool('find', { tabId, query: 'inner frame button' })), /Inner frame button/);
    await tool('computer', { tabId, action: 'left_click', ref });
    await expect(page.frameLocator('#frame').locator('body')).toHaveAttribute('data-clicked', '1');
});

test('scroll and scroll_to', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await tool('computer', { tabId, action: 'scroll', scroll_direction: 'down', scroll_amount: 5 });
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

    const ref = refFor(text(await tool('read_page', { tabId })), /button "Bottom button"/);
    await tool('computer', { tabId, action: 'left_click', ref });
    await expect(page.locator('body')).toHaveAttribute('data-bottom', 'clicked');
});

test('get_page_text and navigate', async () => {
    expect(text(await tool('get_page_text', { tabId }))).toContain('Nova fixture');
    const nav = await tool('navigate', { tabId, url: `${base}/frame.html` });
    expect(text(nav)).toContain('Loaded');
    expect(text(await tool('read_page', { tabId }))).toContain('Inner frame button');
    await tool('navigate', { tabId, url: 'back' });
});

test('tabs outside the group are refused', async () => {
    const other = await context.newPage();
    await other.goto(`${base}/frame.html`);
    const otherId = await panel.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.id, `${base}/frame.html`);
    const result = await tool('read_page', { tabId: otherId });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('not in the Nova tab group');
    await other.close();
});
