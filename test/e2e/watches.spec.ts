import { chromium, expect, test as base, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolatedEnv, removeTree } from './cleanup';

const EXTENSION = fileURLToPath(new URL('../../packages/extension/dist', import.meta.url));

type WatchBrowser = {
    worker: Worker;
    source: Page;
    url: string;
    render: (content: (requests: number) => string) => void;
    requestCount: () => number;
    alerts: () => Promise<Array<{ id: string; text: string }>>;
    openWatchlist: (selection?: string) => Promise<Page>;
};

const test = base.extend<{ watchBrowser: WatchBrowser }>({
    watchBrowser: async ({}, use) => {
        let requests = 0;
        let renderPage: (requests: number) => string = () => '';
        const server = createServer((_request, response) => {
            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
            response.end(`<!doctype html><title>Watch fixture</title>${renderPage(++requests)}`);
        });
        await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
        const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/watched`;
        const root = mkdtempSync(join(tmpdir(), 'nova-watches-'));
        let context: BrowserContext | undefined;
        try {
            context = await chromium.launchPersistentContext(join(root, 'profile'), {
                env: isolatedEnv(root),
                channel: process.env.NOVA_E2E_CHANNEL || 'chromium',
                headless: !process.env.NOVA_E2E_HEADED,
                args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`]
            });
            const browser = context;
            const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker');
            // Capture outgoing notifications without showing them on the test machine's desktop.
            await worker.evaluate(() => {
                chrome.notifications.create = (async (id: string, notification: chrome.notifications.NotificationOptions) => {
                    const { watchAlerts = [] } = await chrome.storage.session.get('watchAlerts');
                    await chrome.storage.session.set({ watchAlerts: [...watchAlerts, { id, text: notification.message }] });
                    return id;
                }) as typeof chrome.notifications.create;
            });
            const alerts = () => worker.evaluate(async () => (await chrome.storage.session.get('watchAlerts')).watchAlerts ?? []);
            const source = await browser.newPage();
            async function openWatchlist(selection?: string): Promise<Page> {
                const [watchlist] = await Promise.all([
                    browser.waitForEvent('page'),
                    worker.evaluate(async ({ url: sourceUrl, selectionText }) => {
                        const [tab] = await chrome.tabs.query({ url: sourceUrl });
                        // Chromium's event dispatch drives the real menu listener in headless tests.
                        const event = chrome.contextMenus.onClicked as typeof chrome.contextMenus.onClicked & {
                            dispatch: (info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab) => void;
                        };
                        event.dispatch({
                            menuItemId: selectionText ? 'nova-watch' : 'nova-watch-page',
                            pageUrl: sourceUrl, frameId: 0, editable: false, selectionText
                        }, tab);
                    }, { url, selectionText: selection })
                ]);
                await expect(watchlist.getByRole('heading', { name: 'Watchlist' })).toBeVisible();
                return watchlist;
            }
            await use({ worker, source, url, render: (content) => { renderPage = content; }, requestCount: () => requests, alerts, openWatchlist });
        } finally {
            await context?.close();
            server.close();
            removeTree(root);
        }
    }
});

test('watch selected text, alert on a scheduled change and retain the last value when the target disappears', async ({ watchBrowser }) => {
    const { worker, source, url, render, requestCount, alerts, openWatchlist } = watchBrowser;
    let price: string | undefined = '€19';
    render((requests) => `<main>${price ? `<p id="price">Total ${price} including VAT</p>` : '<p>Unavailable</p>'}<p>Request ${requests}</p></main>`);
    await expect.poll(() => worker.evaluate(async () => (await chrome.alarms.get('page-watches'))?.periodInMinutes)).toBe(60);
    await source.goto(url);
    await source.locator('#price').evaluate((element) => {
        const range = document.createRange();
        range.setStart(element.firstChild!, 'Total '.length);
        range.setEnd(element.firstChild!, 'Total €19'.length);
        const selection = getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
    });
    const watchlist = await openWatchlist('€19');

    await expect(watchlist.getByText('Watching selected text')).toBeVisible();
    await expect(watchlist.getByText('€19', { exact: true })).toBeVisible();
    await expect(watchlist.getByText('Waiting for first check')).toBeVisible();
    await expect(watchlist.getByRole('link', { name: 'Open source page' })).toHaveAttribute('href', url);

    await watchlist.getByRole('button', { name: 'Check now' }).click();
    await expect(watchlist.getByText('Last checked')).toBeVisible();
    await expect(watchlist.getByText('Change history', { exact: false })).toHaveCount(0);
    expect(await alerts()).toEqual([]);

    price = '€23';
    await worker.evaluate(() => chrome.alarms.create('page-watches', { when: Date.now() + 250, periodInMinutes: 60 }));
    await expect(watchlist.getByText('€23', { exact: true })).toBeVisible({ timeout: 15_000 });
    await watchlist.getByText('Change history (1)', { exact: true }).click();
    await expect(watchlist.getByText('From €19')).toBeVisible();
    await expect(watchlist.getByText('To €23')).toBeVisible();
    await expect.poll(alerts).toEqual([{ id: expect.stringMatching(/^pageWatch:/), text: '€19 → €23' }]);
    expect((await worker.evaluate((sourceUrl) => chrome.tabs.query({ url: sourceUrl }), url)).length).toBe(1);

    const notifications = watchlist.getByRole('checkbox', { name: 'Notify me when watched content changes' });
    await notifications.uncheck();
    await expect.poll(() => worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings?.watchNotifications)).toBe(false);
    price = '€25';
    await watchlist.getByRole('button', { name: 'Check now' }).click();
    await expect(watchlist.getByText('€25', { exact: true })).toBeVisible();
    await expect(watchlist.getByRole('button', { name: 'Check now' })).toBeEnabled();
    expect(await alerts()).toHaveLength(1);

    price = undefined;
    await watchlist.getByRole('button', { name: 'Check now' }).click();
    await expect(watchlist.getByText('The selected text could not be found', { exact: false })).toBeVisible({ timeout: 10_000 });
    await expect(watchlist.getByText('€25', { exact: true })).toBeVisible();
    expect(await alerts()).toHaveLength(1);

    const beforeBlock = requestCount();
    await worker.evaluate((origin) => chrome.storage.local.set({ sitePermissions: { [origin]: 'deny' } }), new URL(url).origin);
    await watchlist.getByRole('button', { name: 'Check now' }).click();
    await expect(watchlist.getByText('This website is blocked', { exact: false })).toBeVisible();
    expect(requestCount()).toBe(beforeBlock);

    await watchlist.reload();
    await expect(watchlist.getByText('€25', { exact: true })).toBeVisible();
    await expect(watchlist.getByText('Change history (2)', { exact: true })).toBeVisible();
    await expect(notifications).not.toBeChecked();
    await watchlist.getByRole('button', { name: 'Remove watch' }).click();
    await expect(watchlist.getByText('No pages watched yet')).toBeVisible();
});

test('watch a page without a selection and show content changes while ignoring page chrome', async ({ watchBrowser }) => {
    const { source, url, render, alerts, openWatchlist } = watchBrowser;
    let listings = '<p>Applications are open</p><ul><li>Office supplies tender</li></ul>';
    let hasMain = true;
    render((requests) => `<header>Site header ${requests}</header><nav>Menu ${requests}</nav>
        ${hasMain ? '<main aria-live="polite">' : ''}
        <h1>Tenders</h1><time>${requests}</time><aside>Banner ${requests}</aside>
        <p style="display:none">Hidden ${requests}</p><span role="status">Status ${requests}</span>${listings}
        ${hasMain ? '</main>' : ''}<footer>Footer ${requests}</footer>`);
    await source.goto(url);
    expect(await source.evaluate(() => getSelection()?.isCollapsed)).toBe(true);
    const watchlist = await openWatchlist();
    await expect(watchlist.getByText('Watching page content')).toBeVisible();
    await expect(watchlist.getByRole('link', { name: 'Open source page' })).toHaveAttribute('href', url);

    const check = watchlist.getByRole('button', { name: 'Check now' });
    await check.click();
    await expect(watchlist.getByText('Last checked')).toBeVisible();
    await expect(check).toBeEnabled();
    await expect(watchlist.getByText('Change history', { exact: false })).toHaveCount(0);
    expect(await alerts()).toEqual([]);

    listings = '<p>Applications are closed</p><ul><li>New <strong>cycling</strong> tender</li></ul>';
    hasMain = false;
    await check.click();
    await watchlist.getByText('Change history (1)', { exact: true }).click();
    await expect(watchlist.getByText('Added (2)', { exact: true })).toBeVisible();
    await expect(watchlist.getByText('Removed (2)', { exact: true })).toBeVisible();
    for (const text of ['Applications are closed', 'New cycling tender', 'Applications are open', 'Office supplies tender']) {
        await expect(watchlist.getByText(text, { exact: true })).toBeVisible();
    }
    await expect.poll(alerts).toEqual([{
        id: expect.stringMatching(/^pageWatch:/), text: 'Added Applications are closed · Removed Applications are open'
    }]);

    await watchlist.reload();
    await expect(watchlist.getByText('Watching page content')).toBeVisible();
    await expect(watchlist.getByText('Change history (1)', { exact: true })).toBeVisible();

    await source.bringToFront();
    await source.getByRole('heading', { name: 'Tenders' }).evaluate((heading) => {
        const selection = getSelection()!;
        const range = document.createRange();
        range.selectNodeContents(heading);
        selection.removeAllRanges();
        selection.addRange(range);
    });
    const combined = await openWatchlist('Tenders');
    await expect(combined.getByText('Watching page content')).toBeVisible();
    await expect(combined.getByText('Watching selected text')).toBeVisible();
});
