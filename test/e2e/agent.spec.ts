/**
 * Runs the real Nova agent from the side panel against the fixture page. Opt-in because it calls
 * the Nova API: NOVA_E2E_AGENT=1, with a key in NOVA_API_KEY or ~/.nova-ai/credentials.json
 * (written by `nova-ai-cli --setup`). NOVA_E2E_MODEL picks the model (default: a vision model).
 */
import { chromium, expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedEnv } from './cleanup';
// @ts-expect-error plain ESM helper without types
import { serveFixtures } from '../serve-fixtures.mjs';

const EXTENSION = fileURLToPath(new URL('../../packages/extension/dist', import.meta.url));
const CREDENTIALS = `${homedir()}/.nova-ai/credentials.json`;
const apiKey = process.env.NOVA_API_KEY ?? (existsSync(CREDENTIALS) ? JSON.parse(readFileSync(CREDENTIALS, 'utf8')).apiKey : undefined);

test.skip(!process.env.NOVA_E2E_AGENT || !apiKey, 'Set NOVA_E2E_AGENT=1 and a Nova API key to run the agent test.');
test.setTimeout(240_000);

test('Nova completes a task in the fixture page from the side panel', async () => {
    const server: Server = await serveFixtures(0);
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const context = await chromium.launchPersistentContext('', {
        // Never touch the user's real Nova AI Browser host files (see cleanup.ts).
        env: isolatedEnv(mkdtempSync(join(tmpdir(), 'nova-'))),
        channel: process.env.NOVA_E2E_CHANNEL || 'chromium',
        headless: !process.env.NOVA_E2E_HEADED,
        viewport: null,
        args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, '--window-size=1280,900']
    });
    try {
        const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
        const panel = await context.newPage();
        await panel.goto(`chrome-extension://${new URL(worker.url()).host}/src/sidepanel/index.html`);
        await panel.evaluate(([key, model]) => chrome.storage.local.set({ settings: { apiKey: key, model } }),
            [apiKey, process.env.NOVA_E2E_MODEL ?? 'gemma4:26b'] as const);

        const page = await context.newPage();
        await page.goto(`${base}/index.html`);
        await page.bringToFront();

        await panel.reload();
        await panel.getByRole('textbox', { name: 'Message Nova' }).fill(
            'In the Nova fixture tab: click the Increment button 3 times, type "Ada Lovelace" in the "Your name" field and choose Green as color. Then tell me the count.');
        await panel.getByRole('button', { name: 'Send' }).click();
        console.log('sent');

        // Drive the run: approve site permission prompts as they appear, until Nova is done.
        const deadline = Date.now() + 200_000;
        while (Date.now() < deadline) {
            const allow = panel.getByRole('button', { name: 'Allow', exact: true });
            if (await allow.count()) await allow.first().click({ timeout: 5_000 }).catch(() => undefined);
            if (await panel.getByRole('button', { name: 'Send' }).count()) break;
            console.log('…', (await panel.locator('.chat').innerText({ timeout: 5_000 }).catch(() => '?')).split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 200));
            await panel.waitForTimeout(1_000);
        }
        for (const head of await panel.locator('button[aria-expanded="false"]').all()) await head.click({ timeout: 2_000 }).catch(() => undefined);
        const transcript = await panel.locator('.chat').innerText();
        console.log(transcript.replace(/\n{2,}/g, '\n'));

        await expect(page.locator('#count')).toHaveText('3');
        await expect(page.locator('#name')).toHaveValue('Ada Lovelace');
        await expect(page.locator('#color')).toHaveValue('g');
        expect(transcript).toMatch(/3/);
    } finally {
        await context.close();
        server.close();
    }
});

test('the user can steer a running task and queue a follow-up', async () => {
    const server: Server = await serveFixtures(0);
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const context = await chromium.launchPersistentContext('', {
        // Never touch the user's real Nova AI Browser host files (see cleanup.ts).
        env: isolatedEnv(mkdtempSync(join(tmpdir(), 'nova-'))),
        channel: process.env.NOVA_E2E_CHANNEL || 'chromium',
        headless: !process.env.NOVA_E2E_HEADED,
        viewport: null,
        args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, '--window-size=1280,900']
    });
    try {
        const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
        const panel = await context.newPage();
        await panel.goto(`chrome-extension://${new URL(worker.url()).host}/src/sidepanel/index.html`);
        await panel.evaluate(([key, model, origin]) => chrome.storage.local.set({
            settings: { apiKey: key, model },
            sitePermissions: { [origin]: 'always' }
        }), [apiKey, process.env.NOVA_E2E_MODEL ?? 'gemma4:26b', base] as const);
        const page = await context.newPage();
        await page.goto(`${base}/index.html`);
        await page.bringToFront();
        await panel.reload();

        const box = panel.getByRole('textbox', { name: 'Message Nova' });
        await box.fill('In the Nova fixture tab, click the Increment button 4 times, one click per step. Report the count when done.');
        await panel.getByRole('button', { name: 'Send' }).click();

        // As soon as Nova is working: steer it, and queue a follow-up for after the reply.
        await expect(panel.getByRole('button', { name: 'Stop' })).toBeVisible();
        await box.fill('Also type "Grace" into the "Your name" field.');
        await box.press('Enter');
        await box.fill('Which color is selected in the Color dropdown? Answer with just the color.');
        await box.press('Enter');
        const queued = panel.getByRole('list', { name: 'Waiting messages' }).getByRole('listitem').last();
        await queued.getByRole('button', { name: /Steer/ }).click(); // switch the second one to "Queued"
        await expect(queued.getByRole('button', { name: /Queued/ })).toBeVisible();

        // Both runs finish: the task with the steering, then the queued follow-up.
        await expect(panel.locator('.user')).toHaveCount(3, { timeout: 200_000 });
        await expect(panel.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 200_000 });
        await expect(panel.getByRole('list', { name: 'Waiting messages' })).toHaveCount(0);

        const transcript = await panel.locator('.chat').innerText();
        console.log(transcript.replace(/\n{2,}/g, '\n'));
        await expect(page.locator('#count')).toHaveText('4');
        await expect(page.locator('#name')).toHaveValue('Grace');
        await expect(panel.locator('.user.steered')).toHaveCount(1);
        expect(transcript.split('Which color is selected').pop()).toMatch(/red/i);
    } finally {
        await context.close();
        server.close();
    }
});
