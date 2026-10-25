/**
 * External agents end to end: the native host is installed into a throwaway browser profile,
 * the browser starts it, and MCP clients drive the browser over stdio (the shim VS Code and
 * Claude Code use) and over HTTP (what ACP agents use).
 *
 * Build first (`npm run build`). Uses NOVA_E2E_CHANNEL like extension.spec.ts.
 */
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostInfoIn, removeTree } from './cleanup';
// @ts-expect-error plain ESM helper without types
import { serveFixtures } from '../serve-fixtures.mjs';

const EXTENSION = fileURLToPath(new URL('../../packages/extension/dist', import.meta.url));
const HOST_DIST = fileURLToPath(new URL('../../packages/host/dist', import.meta.url));

type CallResult = { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean };

let root: string;
let home: string;
let context: BrowserContext;
let server: Server;
let base: string;
let page: Page;
let stdio: Client;

const execFileAsync = promisify(execFile);

/** Waits for the next permission popup and answers it. Returns its text. */
async function answerPopup(button: 'Allow' | 'Always allow' | 'Deny'): Promise<string> {
    const prompt = await context.waitForEvent('page', (p) => p.url().includes('/src/permission/'));
    await prompt.waitForLoadState();
    const content = await prompt.locator('main').innerText();
    await prompt.getByRole('button', { name: button, exact: true }).click();
    return content;
}

function text(result: CallResult): string {
    return result.content.map((block) => block.text ?? '').join('\n');
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs: number, what: string): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = fn();
        if (value !== undefined) return value;
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
}

test.beforeAll(async () => {
    // Short paths: unix socket paths are limited to ~104 characters.
    root = mkdtempSync(join(tmpdir(), 'nova-'));
    home = join(root, 'home');
    const profile = join(root, 'profile');
    // The skill goes into a throwaway Nova home, never the user's own ~/.nova-ai.
    // A fake HOME keeps `install` and the browser away from the user's real browser folders.
    const env = { ...process.env, HOME: root, NOVA_AI_BROWSER_HOME: home, NOVA_AI_HOME: join(root, 'nova') };

    execFileSync(process.execPath, [join(HOST_DIST, 'cli.js'), 'install', '--user-data-dir', profile], { env });

    server = await serveFixtures(0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    context = await chromium.launchPersistentContext(profile, {
        channel: process.env.NOVA_E2E_CHANNEL || 'chromium',
        headless: !process.env.NOVA_E2E_HEADED,
        viewport: null,
        env,
        args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, '--window-size=1280,900']
    });
    if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker');

    // The extension connects to the host on startup; the host publishes hosts/<pid>.json when ready.
    await waitFor(() => hostInfoIn(home) ? true : undefined, 15_000, 'the host');

    page = await context.newPage();
    await page.goto(`${base}/index.html`);
    await page.bringToFront();

    stdio = new Client({ name: 'nova-e2e', version: '1.0.0' });
    await stdio.connect(new StdioClientTransport({ command: process.execPath, args: [join(HOST_DIST, 'mcp.js')], env: env as Record<string, string> }));
});

test.afterAll(async () => {
    await stdio?.close();
    await context?.close();
    server?.close();
    if (root) removeTree(root);
});

test('host is running and publishes its private hosts/<pid>.json', () => {
    const { file, info } = hostInfoIn(home)!;
    expect(info.mcpUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(info.extensionOrigin).toBe('chrome-extension://lnoimoijcjpcebjepmenoepmhbdgnipo/');
    if (process.platform !== 'win32') {
        // eslint-disable-next-line no-bitwise
        expect(execFileSync('stat', process.platform === 'darwin' ? ['-f', '%Lp', file] : ['-c', '%a', file]).toString().trim()).toBe('600');
    }
});

test('stdio MCP lists the browser tools with read-only hints', async () => {
    const { tools } = await stdio.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['computer', 'read_page', 'tabs_context', 'navigate']));
    expect(tools.find((tool) => tool.name === 'read_page')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'computer')?.annotations?.readOnlyHint).toBe(false);
});

test('a new agent must be approved by the user, then each new site', async () => {
    // No side panel is open, so both questions open as popup windows. The calls wait meanwhile.
    const first = stdio.callTool({ name: 'tabs_context', arguments: {} }) as Promise<CallResult>;
    expect(await answerPopup('Allow')).toMatch(/nova-e2e wants to use your browser/);
    const tabs = JSON.parse(text(await first));
    const tabId = tabs.tabs.find((tab: { url: string }) => tab.url.startsWith(base)).tabId;

    const read = stdio.callTool({ name: 'read_page', arguments: { tabId } }) as Promise<CallResult>;
    expect(await answerPopup('Allow')).toContain(`nova-e2e: let Nova use ${base}?`);
    const tree = text(await read);
    const ref = tree.match(/button "Increment" \[(ref_\d+)\]/)?.[1];
    expect(ref).toBeTruthy();

    // Approved: no more questions for this agent and site.
    const click = await stdio.callTool({ name: 'computer', arguments: { tabId, action: 'left_click', ref } }) as CallResult;
    expect(click.isError).toBeFalsy();
    await expect(page.locator('#count')).toHaveText('1');

    const shot = await stdio.callTool({ name: 'computer', arguments: { tabId, action: 'screenshot' } }) as CallResult;
    expect(shot.content.some((block) => block.type === 'image' && (block.data?.length ?? 0) > 1000)).toBe(true);
});

test('a denied agent is refused, and not asked again', async () => {
    const { info } = hostInfoIn(home)!;
    const rogue = new Client({ name: 'rogue-agent', version: '1.0.0' });
    await rogue.connect(new StreamableHTTPClientTransport(new URL(info.mcpUrl), { requestInit: { headers: { authorization: `Bearer ${info.token}` } } }));

    const call = rogue.callTool({ name: 'tabs_context', arguments: {} }) as Promise<CallResult>;
    expect(await answerPopup('Deny')).toMatch(/rogue-agent wants to use your browser/);
    const denied = await call;
    expect(denied.isError).toBe(true);
    expect(text(denied)).toContain('did not allow rogue-agent');

    const again = await rogue.callTool({ name: 'tabs_context', arguments: {} }) as CallResult;
    expect(again.isError).toBe(true);
    await rogue.close();
});

test('HTTP MCP needs the bearer token and works with it', async () => {
    const { info } = hostInfoIn(home)!;
    const unauthorized = await fetch(info.mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(unauthorized.status).toBe(401);
    const fromWeb = await fetch(info.mcpUrl, { method: 'POST', headers: { authorization: `Bearer ${info.token}`, origin: 'https://evil.example' }, body: '{}' });
    expect(fromWeb.status).toBe(403);

    const http = new Client({ name: 'nova-e2e-http', version: '1.0.0' });
    await http.connect(new StreamableHTTPClientTransport(new URL(info.mcpUrl), { requestInit: { headers: { authorization: `Bearer ${info.token}` } } }));
    const pending = http.callTool({ name: 'tabs_context', arguments: {} }) as Promise<CallResult>;
    await answerPopup('Always allow');
    const tabs = JSON.parse(text(await pending));
    const tabId = tabs.tabs.find((tab: { url: string }) => tab.url.startsWith(base)).tabId;
    // The site was already allowed for this task above; the session keeps the agent's name.
    const found = text(await http.callTool({ name: 'find', arguments: { tabId, query: 'your name' } }) as CallResult);
    expect(found).toMatch(/textbox "Your name"/);
    await http.close();
});

test('the nova-browser skill script asks once, then drives the browser from a shell', async () => {
    const script = join(root, 'nova', 'skills', 'nova-browser', 'scripts', process.platform === 'win32' ? 'nova-browser.cmd' : 'nova-browser');
    // The script names the app it runs in (from its parent processes); pin it for the test.
    const env = { ...process.env, HOME: root, NOVA_AI_BROWSER_HOME: home, NOVA_BROWSER_CLIENT: 'Visual Studio Code' };
    const run = async (...args: string[]) => {
        try {
            return { code: 0, out: (await execFileAsync(script, args, { env, encoding: 'utf8' })).stdout };
        } catch (error) {
            const failed = error as { code: number; stdout: string; stderr: string };
            return { code: failed.code, out: `${failed.stdout}${failed.stderr}` };
        }
    };

    expect(existsSync(join(root, 'nova', 'skills', 'nova-browser', 'SKILL.md'))).toBe(true);
    const first = run('tabs_context');
    expect(await answerPopup('Allow')).toMatch(/Visual Studio Code wants to use your browser/);
    const tabs = JSON.parse((await first).out);
    const tabId = tabs.tabs.find((tab: { url: string }) => tab.url.startsWith(base)).tabId;

    const found = await run('find', `tabId=${tabId}`, 'query=increment');
    expect(found.code).toBe(0);
    const ref = found.out.match(/button "Increment" \[(ref_\d+)\]/)?.[1];
    expect((await run('computer', `tabId=${tabId}`, 'action=left_click', `ref=${ref}`)).out).toContain('Clicked button "Increment"');

    const shot = await run('computer', `tabId=${tabId}`, 'action=screenshot');
    const image = shot.out.match(/\[image saved: (.+)\]/)?.[1];
    expect(image && existsSync(image)).toBe(true);

    expect((await run('computer', `tabId=${tabId}`, 'action=left_click', 'ref=ref_99999')).code).toBe(1);
    expect((await run('nonsense')).code).toBe(2);
});

test('pressing Stop on the page blocks external agents', async () => {
    const tabs = JSON.parse(text(await stdio.callTool({ name: 'tabs_context', arguments: {} }) as CallResult));
    const tabId = tabs.tabs.find((tab: { url: string }) => tab.url.startsWith(base)).tabId;
    await stdio.callTool({ name: 'computer', arguments: { tabId, action: 'hover', coordinate: [200, 200] } });

    // The Stop button sits bottom-center in a closed shadow root; a real (trusted) click is required.
    const viewport = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    await page.waitForTimeout(500);
    await page.mouse.click(viewport.w / 2 + 50, viewport.h - 34);

    const refused = await stdio.callTool({ name: 'read_page', arguments: { tabId } }) as CallResult;
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain('pressed Stop');
});

test('saved chats are mirrored to the host as files', async () => {
    const [worker] = context.serviceWorkers();
    const file = join(home, 'sessions', 'e2e-chat.json');
    await worker.evaluate(() => chrome.storage.local.set({ 'session:e2e-chat': { id: 'e2e-chat', title: 'Mirrored', items: [], history: [] } }));
    const saved = await waitFor(() => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined, 5_000, 'the session file');
    expect(saved.title).toBe('Mirrored');

    await worker.evaluate(() => chrome.storage.local.remove('session:e2e-chat'));
    await waitFor(() => existsSync(file) ? undefined : true, 5_000, 'the session file to be removed');
});
