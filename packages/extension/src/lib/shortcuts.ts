import type { Shortcut } from '@datalabrotterdam/nova-ai-browser-protocol';

const KEY = 'shortcuts';

export async function loadShortcuts(): Promise<Shortcut[]> {
    return ((await chrome.storage.local.get(KEY))[KEY] ?? []) as Shortcut[];
}

export async function saveShortcuts(shortcuts: Shortcut[]): Promise<void> {
    await chrome.storage.local.set({ [KEY]: shortcuts });
}

export function onShortcutsChanged(listener: (shortcuts: Shortcut[]) => void): () => void {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
        if (area === 'local' && changes[KEY]) listener((changes[KEY].newValue ?? []) as Shortcut[]);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
}

/** The window a scheduled or manual task runs in: the side panel's page, as a popup, told which shortcut to run. */
export function runShortcutWindow(shortcutId: string): Promise<chrome.windows.Window | undefined> {
    return chrome.windows.create({
        url: chrome.runtime.getURL(`src/sidepanel/index.html?task=${encodeURIComponent(shortcutId)}`),
        type: 'popup',
        width: 460,
        height: 760,
        focused: true
    });
}
