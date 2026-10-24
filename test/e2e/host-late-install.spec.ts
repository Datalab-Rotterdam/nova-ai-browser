/**
 * Regression: the browser runs before the host is installed. The extension must pick up the
 * host once it is installed (on its own retry, or right away when the side panel opens),
 * without a browser restart or extension reload.
 */
import { chromium, expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostInfoIn, removeTree } from './cleanup';

const EXTENSION = fileURLToPath(new URL('../../packages/extension/dist', import.meta.url));
const HOST_DIST = fileURLToPath(new URL('../../packages/host/dist', import.meta.url));

test('connects to a host installed while the browser is running', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nova-'));
    const home = join(root, 'home');
    const profile = join(root, 'profile');
    // A fake HOME keeps `install` away from the user's real browser folders.
    const env = { ...process.env, HOME: root, NOVA_AI_BROWSER_HOME: home, NOVA_AI_HOME: join(root, 'nova') };
    const context = await chromium.launchPersistentContext(profile, {
        channel: process.env.NOVA_E2E_CHANNEL || 'chromium',
        headless: !process.env.NOVA_E2E_HEADED,
        env,
        args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`]
    });
    try {
        const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
        const state = () => worker.evaluate(async () => ((await chrome.storage.session.get('hostStatus')).hostStatus as { state: string } | undefined)?.state);
        await expect.poll(state).not.toMatch(/^(connecting)?$/);
        // macOS browsers find the user-wide registration from the account, whatever HOME says:
        // where the host is installed for real, "not installed" cannot be simulated.
        test.skip(await state() !== 'not-installed', 'The host is installed user-wide for this browser on this machine.');

        execFileSync(process.execPath, [join(HOST_DIST, 'cli.js'), 'install', '--user-data-dir', profile, '--skills', 'none'], { env });

        // Opening the side panel reconnects immediately.
        const panel = await context.newPage();
        await panel.goto(`chrome-extension://${new URL(worker.url()).host}/src/sidepanel/index.html`);
        await expect.poll(() => Boolean(hostInfoIn(home)), { timeout: 10_000 }).toBe(true);
        await expect.poll(state).toBe('connected');
    } finally {
        await context.close();
        removeTree(root);
    }
});
