import { loadWatches, watchKey, type PageWatch, type WatchRequest, type WatchResponse } from '../lib/watches';
import { loadSettings } from '../lib/settings';
import { comparePageContent } from '../lib/watchDiff';
import { originOf, siteRuleFor, storedDecisions } from './permissions';
import { inspectWatchPage, type WatchSnapshot } from './watchPage';

const NOTIFICATION_PREFIX = 'pageWatch:';
const MAX_HISTORY = 10;
const runs = new Map<string, { controller: AbortController; done: Promise<void> }>();
const removals = new Set<string>();
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function ensureWatchAllowed(url: string): Promise<void> {
    const origin = originOf(url);
    if (!origin || (await siteRuleFor(url))?.behavior === 'block' || (await storedDecisions())[origin] === 'deny') {
        throw new Error('This website is blocked in Nova’s Permissions settings.');
    }
}

async function inspect(tabId: number, url: string, request: Parameters<typeof inspectWatchPage>[1]) {
    const [frame] = await chrome.scripting.executeScript({
        target: { tabId },
        func: inspectWatchPage,
        args: [url, request]
    });
    if (!frame?.result) throw new Error('Nova could not read the page.');
    return frame.result;
}

function openWatchlist(error?: string): Promise<chrome.tabs.Tab> {
    const url = new URL(chrome.runtime.getURL('src/options/index.html#watchlist'));
    if (error) url.searchParams.set('watchError', error);
    return chrome.tabs.create({ url: url.href });
}

export async function createWatch(mode: 'page' | 'selection', info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> {
    const { pageUrl, selectionText, frameId, editable } = info;
    let problem: string | undefined;
    try {
        if (tab?.id === undefined || !pageUrl || !/^https?:\/\//.test(pageUrl) || (frameId !== undefined && frameId !== 0)) {
            problem = 'Use the right-click menu in the main web page to start a watch.';
        } else if (tab.incognito) {
            problem = 'Open the page in a regular browser window to start a watch.';
        } else if (mode === 'selection' && (!selectionText || editable)) {
            problem = 'Select visible text in the main page to start a text watch.';
        } else {
            await ensureWatchAllowed(pageUrl);
            const result = await inspect(tab.id, pageUrl, mode === 'page' ? { page: true } : { selection: selectionText ?? '' });
            if ('error' in result) {
                problem = result.error;
            } else {
                // Keep text watch IDs compatible with watches already saved before page watching.
                const identity = JSON.stringify([pageUrl, 'target' in result ? result.target : 'page']);
                const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
                const id = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
                const key = watchKey(id);
                if (!(await chrome.storage.local.get(key))[key]) {
                    const base = { id, url: pageUrl, title: tab.title || new URL(pageUrl).hostname, createdAt: Date.now(), changes: [] };
                    const watch: PageWatch = 'lines' in result ? { ...base, kind: 'page', lines: result.lines } : { ...base, ...result };
                    await chrome.storage.local.set({ [key]: watch });
                }
            }
        }
    } catch (error) {
        problem = error instanceof Error ? error.message : 'Nova could not save this watch. Try again.';
    }
    await openWatchlist(problem);
}

async function readWatch(watch: PageWatch, signal: AbortSignal): Promise<WatchSnapshot> {
    await ensureWatchAllowed(watch.url);
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    const window = windows.find((candidate) => !candidate.incognito);
    if (window?.id === undefined) throw new Error('Open a regular browser window to check this watch.');
    signal.throwIfAborted();
    const tab = await chrome.tabs.create({ windowId: window.id, url: watch.url, active: false });
    if (tab.id === undefined) throw new Error('Nova could not open the source page.');

    try {
        const deadline = Date.now() + 15_000;
        for (;;) {
            signal.throwIfAborted();
            const current = await chrome.tabs.get(tab.id);
            if (current.status === 'complete' && current.url && current.url !== 'about:blank' && !current.pendingUrl) break;
            if (Date.now() >= deadline) throw new Error('The source page took too long to load.');
            await delay(250);
        }

        // Give scripts a brief chance to render the watched content.
        await delay(500);
        const renderDeadline = Date.now() + 4_000;
        for (;;) {
            signal.throwIfAborted();
            const current = await chrome.tabs.get(tab.id);
            if (current.url !== watch.url) throw new Error('The page redirected. Open the source page to check whether you need to sign in.');
            const result = await inspect(tab.id, watch.url, watch.kind === 'page' ? { page: true } : { target: watch.target });
            if (!('error' in result)) return result;
            if (Date.now() >= renderDeadline) throw new Error(result.error);
            await delay(400);
        }
    } finally {
        await chrome.tabs.remove(tab.id).catch(() => undefined);
    }
}

function recordCheck(watch: PageWatch, snapshot: WatchSnapshot, checkedAt: number): { next: PageWatch; notification?: string } {
    const status = { checkedAt, error: undefined };
    if (watch.kind === 'page' && 'lines' in snapshot) {
        const change = comparePageContent(watch.lines, snapshot.lines, checkedAt);
        const changes = change ? [change, ...watch.changes].slice(0, MAX_HISTORY) : watch.changes;
        const next = { ...watch, ...status, lines: snapshot.lines, changes };
        if (!change) return { next };
        const added = change.added[0] ? `Added ${change.added[0].slice(0, 70)}` : '';
        const removed = change.removed[0] ? `Removed ${change.removed[0].slice(0, 70)}` : '';
        return { next, notification: [added, removed].filter(Boolean).join(' · ') };
    }
    if (watch.kind !== 'page' && 'value' in snapshot) {
        const { value } = snapshot;
        const change = value === watch.value ? undefined : { at: checkedAt, previous: watch.value, current: value };
        const changes = change ? [change, ...watch.changes].slice(0, MAX_HISTORY) : watch.changes;
        const notification = change ? `${change.previous.slice(0, 80)} → ${change.current.slice(0, 80)}` : undefined;
        return { next: { ...watch, ...status, value, changes }, notification };
    }
    throw new Error('Nova could not read the watched content.');
}

async function runCheck(id: string, signal: AbortSignal): Promise<void> {
    const key = watchKey(id);
    const watch = (await chrome.storage.local.get(key))[key] as PageWatch | undefined;
    if (!watch || signal.aborted) return;
    let checked: ReturnType<typeof recordCheck>;
    try {
        const snapshot = await readWatch(watch, signal);
        checked = recordCheck(watch, snapshot, Date.now());
    } catch (error) {
        if (signal.aborted) return;
        const message = error instanceof Error ? error.message : 'Nova could not check the source page.';
        await chrome.storage.local.set({ [key]: { ...watch, checkedAt: Date.now(), error: message } });
        return;
    }
    if (signal.aborted) return;
    const { next, notification } = checked;
    await chrome.storage.local.set({ [key]: next });
    if (!notification || !(await loadSettings()).watchNotifications || signal.aborted) return;
    await chrome.notifications.create(`${NOTIFICATION_PREFIX}${id}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title: watch.title.slice(0, 80),
        message: notification
    }).catch(() => undefined);
}

function checkWatch(id: string): Promise<void> {
    const active = runs.get(id);
    if (active) return active.done;
    if (removals.has(id)) return Promise.resolve();
    const controller = new AbortController();
    const done = runCheck(id, controller.signal).finally(() => runs.delete(id));
    runs.set(id, { controller, done });
    return done;
}

export async function checkWatches(): Promise<void> {
    for (const watch of await loadWatches()) {
        await checkWatch(watch.id).catch(() => undefined);
    }
}

export async function handleWatchRequest({ type, id }: WatchRequest): Promise<WatchResponse> {
    try {
        if (type === 'watch/check') {
            await checkWatch(id);
        } else {
            removals.add(id);
            try {
                runs.get(id)?.controller.abort();
                await chrome.storage.local.remove(watchKey(id));
                await chrome.notifications.clear(`${NOTIFICATION_PREFIX}${id}`);
            } finally {
                removals.delete(id);
            }
        }
        return { ok: true };
    } catch {
        return { ok: false, error: 'Nova could not update this watch. Try again.' };
    }
}

chrome.notifications.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith(NOTIFICATION_PREFIX)) return;
    const key = watchKey(notificationId.slice(NOTIFICATION_PREFIX.length));
    void chrome.storage.local.get(key).then(async (items) => {
        const watch = items[key] as PageWatch | undefined;
        if (watch) await chrome.tabs.create({ url: watch.url });
        await chrome.notifications.clear(notificationId);
    }).catch(() => undefined);
});
