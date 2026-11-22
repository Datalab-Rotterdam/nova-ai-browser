export interface WatchTarget {
    selector: string;
    before: string;
    after: string;
}

export interface WatchChange {
    at: number;
    previous: string;
    current: string;
}

export interface PageContentChange {
    at: number;
    added: string[];
    removed: string[];
    addedCount: number;
    removedCount: number;
}

interface Watch {
    id: string;
    url: string;
    title: string;
    createdAt: number;
    checkedAt?: number;
    error?: string;
}

// Stored text watches predate the whole-page mode and have no kind field.
export interface TextWatch extends Watch {
    kind?: never;
    target: WatchTarget;
    value: string;
    changes: WatchChange[];
}

export interface ContentWatch extends Watch {
    kind: 'page';
    lines: string[];
    changes: PageContentChange[];
}

export type PageWatch = TextWatch | ContentWatch;

export type WatchRequest = { type: 'watch/check' | 'watch/delete'; id: string };
export type WatchResponse = { ok: true } | { ok: false; error: string };

const PREFIX = 'pageWatch:';

export function watchKey(id: string): string {
    return `${PREFIX}${id}`;
}

export async function loadWatches(): Promise<PageWatch[]> {
    const values = await chrome.storage.local.get(null);
    return Object.entries(values)
        .filter(([key]) => key.startsWith(PREFIX))
        .map(([, value]) => value as PageWatch)
        .sort((a, b) => b.createdAt - a.createdAt);
}

export function onWatchesChanged(listener: () => void): () => void {
    const onChange: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
        if (area === 'local' && Object.keys(changes).some((key) => key.startsWith(PREFIX))) listener();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
}
