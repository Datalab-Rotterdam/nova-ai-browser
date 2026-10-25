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

    // Nova starts in a new empty tab and leaves the user's tabs alone…
    const started = JSON.parse(text(await tool('tabs_context'))) as { tabs: Array<{ tabId: number; url: string }> };
    expect(started.tabs.map((tab) => tab.url), 'Nova starts in its own empty tab').toEqual(['about:blank']);
    // …until the user hands one over ("Use this tab").
    await page.bringToFront();
    await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'tabs/add-current' }));
    const context0 = JSON.parse(text(await tool('tabs_context'))) as { tabs: Array<{ tabId: number; url: string }> };
    const fixtureTab = context0.tabs.find((tab) => tab.url.startsWith(base));
    expect(fixtureTab, 'the handed-over tab joins the Nova group').toBeTruthy();
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

test('tabs Nova is using show the Nova mark as favicon, until Nova is done', async () => {
    const [second] = await Promise.all([
        context.waitForEvent('page'),
        tool('tabs_create', { url: `${base}/frame.html` })
    ]);
    await second.waitForLoadState();
    const secondId = await panel.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.id, `${base}/frame.html`);
    await tool('read_page', { tabId });
    await tool('read_page', { tabId: secondId });

    const favicons = () => panel.evaluate(async (ids) => Promise.all(ids.map(async (id) => (await chrome.tabs.get(id)).favIconUrl ?? '')), [tabId, secondId!]);
    await expect.poll(async () => (await favicons()).map((url) => url.startsWith('data:image/svg+xml'))).toEqual([true, true]);

    await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'agent/running', running: false }));
    await expect(page.locator('#nova-ai-favicon')).toHaveCount(0);
    await expect(second.locator('#nova-ai-favicon')).toHaveCount(0);
    await tool('tabs_close', { tabId: secondId });
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

test('the panel reopens the last chat, with open prompts expired', async () => {
    await panel.evaluate(async (baseUrl) => {
        await chrome.storage.local.set({
            settings: { apiKey: 'e2e-key', baseUrl, model: 'e2e-model' },
            sessions: ['e2e-chat'],
            'session:e2e-chat': {
                id: 'e2e-chat', title: 'Restore me', createdAt: 1, updatedAt: 2, model: 'e2e-model', history: [],
                items: [
                    { kind: 'user', id: 1, text: 'Restore me' },
                    { kind: 'assistant', id: 2, text: 'Restored reply', thinking: '' },
                    { kind: 'permission', id: 3, requestId: 'gone', subject: 'site', target: 'https://example.com', tool: 'read_page', summary: 'read page' }
                ]
            }
        });
    }, `${base}/v1`);
    await panel.reload();
    await expect(panel.getByText('Restored reply')).toBeVisible();
    await expect(panel.locator('.answered')).toHaveText('Expired');
    await panel.evaluate(() => chrome.storage.local.clear());
});

test('the model menu sets the reasoning effort sent to Nova', async () => {
    const requests: Array<Record<string, unknown>> = [];
    await panel.route(`${base}/v1/**`, async (route) => {
        if (route.request().url().endsWith('/models')) {
            return route.fulfill({ json: { object: 'list', data: [
                { id: 'thinker', object: 'model', created: 1, owned_by: 'e2e', name: 'Thinker', capabilities: ['tools'], reasoning_efforts: ['low', 'medium', 'high'] }
            ] } });
        }
        requests.push(route.request().postDataJSON());
        const chunk = { object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'Done thinking.' }, finish_reason: 'stop' }] };
        return route.fulfill({ headers: { 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n` });
    });
    await panel.evaluate((baseUrl) => chrome.storage.local.set({ settings: { apiKey: 'e2e-key', baseUrl, model: 'thinker' } }), `${base}/v1`);
    await panel.reload();

    const chip = panel.getByRole('button', { name: 'Model' });
    await expect(chip).toHaveText(/Thinker \(Medium\)/);
    await chip.click();
    await panel.getByRole('radio', { name: 'High' }).click();
    await panel.keyboard.press('Escape');
    await expect(chip).toHaveText(/Thinker \(High\)/);

    await panel.getByRole('textbox', { name: 'Message Nova' }).fill('Hi');
    await panel.getByRole('button', { name: 'Send' }).click();
    await expect(panel.getByText('Done thinking.')).toBeVisible();
    expect(requests[0]).toMatchObject({ model: 'thinker', reasoning_effort: 'high' });

    await panel.unrouteAll();
    await panel.evaluate(() => chrome.storage.local.clear());
    await panel.reload();
});

test('full-page screenshot covers the whole page and leaves click coordinates alone', async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const shot = await tool('computer', { tabId, action: 'screenshot', full_page: true });
    const image = shot.content.find((block) => block.type === 'image');
    expect(image).toBeTruthy();
    const [, pageW, pageH] = text(shot).match(/page (\d+)x(\d+) CSS px/)!;
    const viewport = await page.evaluate(() => ({ h: window.innerHeight, scroll: document.documentElement.scrollHeight }));
    expect(Number(pageH)).toBe(viewport.scroll);
    expect(Number(pageH)).toBeGreaterThan(viewport.h);

    // The bottom button, far below the window, is drawn where it is on the page (no repeated or stretched slices).
    const button = await page.evaluate(() => {
        const rect = document.getElementById('bottom')!.getBoundingClientRect();
        return { x: rect.x + window.scrollX, y: rect.y + window.scrollY, w: rect.width, h: rect.height };
    });
    const dark = await panel.evaluate(async ({ src, button, pageW }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const k = img.naturalWidth / pageW;
        const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(button.x * k, button.y * k, Math.max(1, button.w * k), Math.max(1, button.h * k));
        let count = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 300) count++;
        return count;
    }, { src: `data:image/jpeg;base64,${(image as { data: string }).data}`, button, pageW: Number(pageW) });
    expect(dark).toBeGreaterThan(5);

    // The user gets the full-resolution image, with a note that the model got a smaller copy.
    const [, modelW] = text(shot).match(/image (\d+)x(\d+)px/)!;
    expect(shot.userImage?.note).toMatch(/Nova only got a scaled-down copy/);
    const full = await panel.evaluate(async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        return img.naturalWidth;
    }, `data:image/jpeg;base64,${shot.userImage!.data}`);
    expect(full).toBeGreaterThan(Number(modelW));

    // Clicking by the coordinates of a normal screenshot still works afterwards.
    const normal = await tool('computer', { tabId, action: 'screenshot' });
    const [, w, h] = text(normal).match(/Image is (\d+)x(\d+)px/)!;
    const box = (await page.locator('#increment').boundingBox())!;
    const inner = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const before = Number(await page.locator('#count').innerText());
    await tool('computer', { tabId, action: 'left_click', coordinate: [(box.x + box.width / 2) * Number(w) / inner.w, (box.y + box.height / 2) * Number(h) / inner.h] });
    await expect(page.locator('#count')).toHaveText(String(before + 1));
});

test('a screenshot in the panel opens in a zoomable viewer', async () => {
    await panel.evaluate((baseUrl) => chrome.storage.local.set({ settings: { apiKey: 'e2e-key', baseUrl, model: 'e2e-model' } }), `${base}/v1`);
    await panel.reload();
    await panel.getByRole('button', { name: 'Tool tester' }).click();
    await panel.locator('#tool').selectOption('computer');
    await panel.locator('#args').fill(JSON.stringify({ tabId, action: 'screenshot', full_page: true }));
    await page.bringToFront();
    await panel.locator('button[type=submit]').click();
    await panel.locator('.shot-button').last().click();

    const viewer = panel.getByRole('dialog', { name: 'Full-page screenshot' });
    await expect(viewer).toBeVisible();
    const image = viewer.locator('img');
    const fitted = (await image.boundingBox())!.width;
    await viewer.getByRole('button', { name: 'Zoom in' }).click();
    await expect(viewer.locator('.level')).toHaveText('1.5×');
    expect((await image.boundingBox())!.width).toBeCloseTo(fitted * 1.5, 0);

    // A trackpad pinch (ctrl + wheel) zooms; 0 fits again; Escape closes.
    const stage = (await viewer.locator('.stage').boundingBox())!;
    await panel.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await panel.keyboard.down('Control');
    await panel.mouse.wheel(0, -200);
    await panel.keyboard.up('Control');
    await expect(viewer.locator('.level')).toHaveText('4.1×');
    await panel.keyboard.press('0');
    await expect(viewer.locator('.level')).toHaveText('1.0×');
    await panel.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await panel.evaluate(() => chrome.storage.local.clear());
});

// Last: it ends the group the other tests use.
test('a new chat closes the tabs Nova opened and gives the user\'s tabs back', async () => {
    const tabs = JSON.parse(text(await tool('tabs_context'))) as { tabs: Array<{ tabId: number; url: string }> };
    const novaTab = tabs.tabs.find((tab) => tab.url === 'about:blank')!.tabId;
    await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'tabs/release' }));
    const state = await panel.evaluate(async ([nova, user]) => ({
        novaOpen: await chrome.tabs.get(nova).then(() => true, () => false),
        userGroup: (await chrome.tabs.get(user)).groupId
    }), [novaTab, tabId] as const);
    expect(state).toEqual({ novaOpen: false, userGroup: -1 });
    expect(page.isClosed()).toBe(false);
});

// After the group test: opening another chat ends the current one, and with it Nova's tabs.
test('the chat list reopens and deletes saved chats', async () => {
    const session = (id: string, title: string, reply: string, updatedAt: number) => ({
        id, title, createdAt: 1, updatedAt, model: 'e2e-model', history: [],
        items: [{ kind: 'user', id: 1, text: title }, { kind: 'assistant', id: 2, text: reply, thinking: '' }]
    });
    await panel.evaluate(async ([baseUrl, chats]) => {
        await chrome.storage.local.set({
            settings: { apiKey: 'e2e-key', baseUrl, model: 'e2e-model' },
            sessions: chats.map((chat) => chat.id),
            ...Object.fromEntries(chats.map((chat) => [`session:${chat.id}`, chat]))
        });
    }, [`${base}/v1`, [session('newer', 'Newer chat', 'Newer reply', 2), session('older', 'Older chat', 'Older reply', 1)]] as const);
    await panel.reload();
    await expect(panel.getByText('Newer reply')).toBeVisible();

    await panel.getByRole('button', { name: 'Chats' }).click();
    await panel.getByRole('button', { name: /^Older chat/ }).click();
    await expect(panel.getByText('Older reply')).toBeVisible();
    await expect(panel.getByText('Newer reply')).toHaveCount(0);

    panel.once('dialog', (dialog) => void dialog.accept());
    await panel.getByRole('button', { name: 'Chats' }).click();
    await panel.getByRole('button', { name: 'Delete Newer chat' }).click();
    await expect(panel.getByRole('button', { name: /^Newer chat/ })).toHaveCount(0);
    expect(await panel.evaluate(async () => ({ ...(await chrome.storage.local.get(['sessions', 'session:newer'])) }))).toEqual({ sessions: ['older'] });

    await panel.evaluate(() => chrome.storage.local.clear());
    await panel.reload();
});
