/**
 * Ways into Nova from outside the panel: the right-click menu, the address bar keyword and the
 * first-run page. Chat actions prefill a prompt. Watch actions save a watch and open the watchlist.
 */
import { addTabToGroup } from './tabs';
import { createWatch } from './watches';

export const PENDING_PROMPT = 'pendingPrompt';

const MENU = {
    selection: 'nova-selection',
    page: 'nova-page',
    link: 'nova-link',
    watchSelection: 'nova-watch',
    watchPage: 'nova-watch-page'
} as const;

const WEB_PAGES = ['http://*/*', 'https://*/*'];

/** The prompt for a context menu click; `undefined` for an item that is not ours. */
export function promptFor(info: { menuItemId: string | number; selectionText?: string; linkUrl?: string; pageUrl?: string }): string | undefined {
    switch (info.menuItemId) {
        case MENU.selection:
            return `About this text from ${info.pageUrl ?? 'the page'}:\n\n"${(info.selectionText ?? '').trim()}"\n\n`;
        case MENU.page:
            return 'Summarize this page in five bullet points.';
        case MENU.link:
            return `Open ${info.linkUrl ?? 'this link'} and tell me what it is about.`;
        default:
            return undefined;
    }
}

async function openPanel(windowId: number | undefined, prompt: string): Promise<void> {
    await chrome.storage.session.set({ [PENDING_PROMPT]: { text: prompt, at: Date.now() } });
    if (windowId !== undefined) await chrome.sidePanel.open({ windowId }).catch(() => undefined);
}

chrome.runtime.onInstalled.addListener((details) => {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({ id: MENU.selection, title: 'Ask Nova about “%s”', contexts: ['selection'] });
        chrome.contextMenus.create({ id: MENU.page, title: 'Summarize this page with Nova', contexts: ['page'] });
        chrome.contextMenus.create({ id: MENU.link, title: 'Ask Nova about this link', contexts: ['link'] });
        chrome.contextMenus.create({ id: MENU.watchSelection, title: 'Watch selected text', contexts: ['selection'], documentUrlPatterns: WEB_PAGES });
        chrome.contextMenus.create({ id: MENU.watchPage, title: 'Watch this page', contexts: ['page', 'selection'], documentUrlPatterns: WEB_PAGES });
    });
    if (details.reason === 'install') {
        void chrome.tabs.create({ url: chrome.runtime.getURL('src/options/index.html#welcome') });
    }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU.watchSelection || info.menuItemId === MENU.watchPage) {
        void createWatch(info.menuItemId === MENU.watchPage ? 'page' : 'selection', info, tab).catch(() => undefined);
        return;
    }
    const prompt = promptFor(info);
    if (!prompt) return;
    // Opening the panel needs the click as the user gesture, so nothing is awaited before it.
    const windowId = tab?.windowId;
    if (windowId !== undefined) void chrome.sidePanel.open({ windowId }).catch(() => undefined);
    void chrome.storage.session.set({ [PENDING_PROMPT]: { text: prompt, at: Date.now() } });
    // The page the user asked about is the one Nova should look at.
    if ((info.menuItemId === MENU.selection || info.menuItemId === MENU.page) && tab?.id !== undefined) {
        void addTabToGroup(tab.id).catch(() => undefined);
    }
});

// `nova <question>` in the address bar.
chrome.omnibox.setDefaultSuggestion({ description: 'Ask Nova: %s' });
chrome.omnibox.onInputEntered.addListener((text) => {
    const question = text.trim();
    if (!question) return;
    void chrome.windows.getCurrent().then((win) => openPanel(win.id, question));
});
