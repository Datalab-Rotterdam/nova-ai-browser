/**
 * The agent works only in its own tab group, so the user can see (and keep apart) which tabs
 * Nova controls. The group starts with a new empty tab: the user's tabs join only when they hand
 * one over ("Use this tab"). When the chat ends, the tabs Nova opened are closed and the user's
 * are ungrouped. Group id and opened tabs are kept in session storage to survive service worker
 * restarts.
 */

const GROUP_KEY = 'novaGroupId';
const OPENED_KEY = 'novaOpenedTabs';
const GROUP_TITLE = 'Nova';

export interface TabInfo {
    tabId: number;
    url: string;
    title: string;
    active: boolean;
    status?: string;
}

async function storedGroupId(): Promise<number | undefined> {
    const value = (await chrome.storage.session.get(GROUP_KEY))[GROUP_KEY] as number | undefined;
    if (value === undefined) return undefined;
    try {
        await chrome.tabGroups.get(value);
        return value;
    } catch {
        await chrome.storage.session.remove(GROUP_KEY);
        return undefined;
    }
}

async function createGroup(tabIds: [number, ...number[]], windowId?: number): Promise<number> {
    const groupId = await chrome.tabs.group({ tabIds, ...(windowId !== undefined ? { createProperties: { windowId } } : {}) });
    await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color: 'purple' });
    await chrome.storage.session.set({ [GROUP_KEY]: groupId });
    return groupId;
}

async function openedTabs(): Promise<number[]> {
    return ((await chrome.storage.session.get(OPENED_KEY))[OPENED_KEY] as number[] | undefined) ?? [];
}

async function rememberOpened(tabId: number): Promise<void> {
    await chrome.storage.session.set({ [OPENED_KEY]: [...await openedTabs(), tabId] });
}

/** Returns the Nova group, creating it around a new empty tab when missing. */
export async function ensureGroup(): Promise<number> {
    const existing = await storedGroupId();
    if (existing !== undefined) return existing;

    const [current] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true, windowId: current?.windowId });
    await rememberOpened(tab.id!);
    return createGroup([tab.id!], tab.windowId);
}

/** Ends the group: closes the tabs Nova opened and gives the user's tabs back ungrouped. */
export async function releaseGroup(): Promise<void> {
    const groupId = await storedGroupId();
    const opened = new Set(await openedTabs());
    await chrome.storage.session.remove([GROUP_KEY, OPENED_KEY]);
    if (groupId === undefined) return;
    const tabIds = (await chrome.tabs.query({ groupId })).map((tab) => tab.id!);
    const users = tabIds.filter((id) => !opened.has(id));
    if (users.length) await chrome.tabs.ungroup(users as [number, ...number[]]);
    await chrome.tabs.remove(tabIds.filter((id) => opened.has(id)));
}

/** Adds a tab the user picked (e.g. the side panel's "Use this tab") to the group. */
export async function addTabToGroup(tabId: number): Promise<number> {
    const existing = await storedGroupId();
    if (existing === undefined) {
        const tab = await chrome.tabs.get(tabId);
        return createGroup([tabId], tab.windowId);
    }
    await chrome.tabs.group({ groupId: existing, tabIds: [tabId] });
    return existing;
}

export async function groupTabs(): Promise<chrome.tabs.Tab[]> {
    const groupId = await storedGroupId();
    if (groupId === undefined) return [];
    return chrome.tabs.query({ groupId });
}

export function describeTab(tab: chrome.tabs.Tab): TabInfo {
    return { tabId: tab.id!, url: tab.url ?? tab.pendingUrl ?? '', title: tab.title ?? '', active: tab.active, status: tab.status };
}

export async function isInGroup(tabId: number): Promise<boolean> {
    const groupId = await storedGroupId();
    if (groupId === undefined) return false;
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    return tab?.groupId === groupId;
}

/** Throws a model-readable error unless the tab exists and belongs to the Nova group. */
export async function requireGroupTab(tabId: unknown): Promise<chrome.tabs.Tab> {
    const id = Number(tabId);
    if (!Number.isInteger(id)) {
        throw new Error('tabId is required. Call tabs_context to get tab ids.');
    }
    const tab = await chrome.tabs.get(id).catch(() => undefined);
    if (!tab) {
        throw new Error(`Tab ${id} does not exist. Call tabs_context for current tabs.`);
    }
    const groupId = await storedGroupId();
    if (groupId === undefined || tab.groupId !== groupId) {
        throw new Error(`Tab ${id} is not in the Nova tab group. Use tabs_context or tabs_create.`);
    }
    return tab;
}

export async function createTab(url?: string): Promise<chrome.tabs.Tab> {
    const groupId = await ensureGroup();
    const [first] = await chrome.tabs.query({ groupId });
    const tab = await chrome.tabs.create({ url: url ?? 'about:blank', active: true, windowId: first?.windowId });
    await rememberOpened(tab.id!);
    await chrome.tabs.group({ groupId, tabIds: [tab.id!] });
    return tab;
}

/** Brings the tab to the front: screenshots and smooth rendering need a visible tab. */
export async function focusTab(tab: chrome.tabs.Tab): Promise<void> {
    if (!tab.active) {
        await chrome.tabs.update(tab.id!, { active: true });
    }
}

/** Waits until the tab has finished loading, or the timeout passes. Returns whether it finished. */
export function waitForLoad(tabId: number, timeoutMs = 20_000): Promise<boolean> {
    return new Promise((resolve) => {
        let done = false;
        const finish = (value: boolean) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(value);
        };
        const listener = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
            if (id === tabId && info.status === 'complete') finish(true);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.get(tabId).then((tab) => {
            if (tab.status === 'complete') finish(true);
        }, () => finish(false));
    });
}

/** After an action that may navigate: give the page a moment, then wait for a started load. */
export async function settle(tabId: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (tab?.status === 'loading') {
        await waitForLoad(tabId, 10_000);
    }
}
