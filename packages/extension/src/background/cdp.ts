/**
 * Chrome DevTools Protocol access through chrome.debugger. One attachment per tab, made on
 * first use. Console, network and dialog events are buffered per tab for the devtools tools.
 */

const PROTOCOL_VERSION = '1.3';
const MAX_BUFFER = 500;

export interface ConsoleEntry {
    level: string;
    text: string;
    url?: string;
    time: number;
}

export interface NetworkEntry {
    requestId: string;
    method: string;
    url: string;
    type?: string;
    status?: number;
    failed?: string;
    time: number;
}

const attachments = new Map<number, Promise<void>>();
const consoleBuffers = new Map<number, ConsoleEntry[]>();
const networkBuffers = new Map<number, Map<string, NetworkEntry>>();
const dialogNotes = new Map<number, string[]>();
const detachListeners = new Set<(tabId: number, reason: string) => void>();

export function isAttached(tabId: number): boolean {
    return attachments.has(tabId);
}

export function attach(tabId: number): Promise<void> {
    let pending = attachments.get(tabId);
    if (!pending) {
        pending = (async () => {
            try {
                await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (!/already attached/i.test(message)) {
                    throw new Error(friendlyAttachError(message));
                }
            }
            await Promise.all([
                rawSend(tabId, 'Page.enable'),
                rawSend(tabId, 'Runtime.enable'),
                rawSend(tabId, 'Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0 })
            ]);
        })();
        attachments.set(tabId, pending);
        pending.catch(() => attachments.delete(tabId));
    }
    return pending;
}

function friendlyAttachError(message: string): string {
    if (/cannot access|cannot attach|chrome:\/\/|chrome-extension|webstore/i.test(message)) {
        return 'Nova cannot control this page (browser pages, other extensions and the Web Store are off limits). Navigate to a website first.';
    }
    if (/no tab with given id/i.test(message)) {
        return 'That tab no longer exists. Call tabs_context for current tabs.';
    }
    return `Could not attach to the tab: ${message}`;
}

export async function detach(tabId: number): Promise<void> {
    if (!attachments.delete(tabId)) return;
    try {
        await chrome.debugger.detach({ tabId });
    } catch {
        // Already gone (tab closed or user cancelled).
    }
}

export async function detachAll(): Promise<void> {
    await Promise.all(Array.from(attachments.keys()).map(detach));
}

function rawSend<T>(tabId: number, method: string, params?: object, timeoutMs = 20_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${method} timed out after ${timeoutMs / 1000}s. A dialog or a busy page may be blocking it.`)), timeoutMs);
        chrome.debugger.sendCommand({ tabId }, method, params as Record<string, unknown> | undefined).then(
            (result) => {
                clearTimeout(timer);
                resolve(result as T);
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        );
    });
}

/** Sends a CDP command, attaching first when needed. */
export async function send<T = unknown>(tabId: number, method: string, params?: object, timeoutMs?: number): Promise<T> {
    await attach(tabId);
    return rawSend<T>(tabId, method, params, timeoutMs);
}

export function onDetach(listener: (tabId: number, reason: string) => void): void {
    detachListeners.add(listener);
}

/** Returns and clears notes about dialogs Nova handled since the last call. */
export function takeDialogNotes(tabId: number): string[] {
    const notes = dialogNotes.get(tabId) ?? [];
    dialogNotes.delete(tabId);
    return notes;
}

export function consoleEntries(tabId: number): ConsoleEntry[] {
    return consoleBuffers.get(tabId) ?? [];
}

export function networkEntries(tabId: number): NetworkEntry[] {
    return Array.from(networkBuffers.get(tabId)?.values() ?? []);
}

export function clearConsole(tabId: number): void {
    consoleBuffers.delete(tabId);
}

export function clearNetwork(tabId: number): void {
    networkBuffers.delete(tabId);
}

function pushConsole(tabId: number, entry: ConsoleEntry): void {
    const buffer = consoleBuffers.get(tabId) ?? [];
    buffer.push(entry);
    if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
    consoleBuffers.set(tabId, buffer);
}

function networkBuffer(tabId: number): Map<string, NetworkEntry> {
    let buffer = networkBuffers.get(tabId);
    if (!buffer) {
        buffer = new Map();
        networkBuffers.set(tabId, buffer);
    }
    if (buffer.size > MAX_BUFFER) {
        const first = buffer.keys().next().value;
        if (first !== undefined) buffer.delete(first);
    }
    return buffer;
}

interface RemoteObject {
    type: string;
    value?: unknown;
    description?: string;
}

function formatRemoteObject(object: RemoteObject): string {
    if (object.value !== undefined) {
        return typeof object.value === 'string' ? object.value : JSON.stringify(object.value);
    }
    return object.description ?? object.type;
}

chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source.tabId;
    if (tabId === undefined) return;
    const p = (params ?? {}) as Record<string, any>;

    switch (method) {
        case 'Runtime.consoleAPICalled':
            pushConsole(tabId, {
                level: p.type,
                text: (p.args as RemoteObject[] ?? []).map(formatRemoteObject).join(' '),
                url: p.stackTrace?.callFrames?.[0]?.url,
                time: Date.now()
            });
            break;
        case 'Runtime.exceptionThrown': {
            const details = p.exceptionDetails ?? {};
            pushConsole(tabId, {
                level: 'exception',
                text: details.exception?.description ?? details.text ?? 'Uncaught exception',
                url: details.url,
                time: Date.now()
            });
            break;
        }
        case 'Network.requestWillBeSent':
            networkBuffer(tabId).set(p.requestId, {
                requestId: p.requestId,
                method: p.request?.method,
                url: p.request?.url,
                type: p.type,
                time: Date.now()
            });
            break;
        case 'Network.responseReceived': {
            const entry = networkBuffers.get(tabId)?.get(p.requestId);
            if (entry) entry.status = p.response?.status;
            break;
        }
        case 'Network.loadingFailed': {
            const entry = networkBuffers.get(tabId)?.get(p.requestId);
            if (entry) entry.failed = p.errorText;
            break;
        }
        case 'Page.javascriptDialogOpening': {
            // Dialogs block all input. Accept alerts and leave-page prompts, dismiss confirm/prompt
            // so the agent never agrees to something on the user's behalf; tell the agent either way.
            const accept = p.type === 'alert' || p.type === 'beforeunload';
            void rawSend(tabId, 'Page.handleJavaScriptDialog', { accept }).catch(() => undefined);
            const notes = dialogNotes.get(tabId) ?? [];
            notes.push(`A ${p.type} dialog appeared ("${String(p.message ?? '').slice(0, 200)}") and was ${accept ? 'accepted' : 'dismissed'}.`);
            dialogNotes.set(tabId, notes);
            break;
        }
    }
});

chrome.debugger.onDetach.addListener((source, reason) => {
    const tabId = source.tabId;
    if (tabId === undefined) return;
    attachments.delete(tabId);
    for (const listener of detachListeners) listener(tabId, reason);
});

chrome.tabs.onRemoved.addListener((tabId) => {
    attachments.delete(tabId);
    consoleBuffers.delete(tabId);
    networkBuffers.delete(tabId);
    dialogNotes.delete(tabId);
});
