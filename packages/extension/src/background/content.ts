/**
 * Messaging with the extension's content scripts in a tab's top frame. Tabs that were open
 * before the extension was installed or reloaded have no content scripts yet; they are
 * injected on demand from the manifest's own entries.
 */
import type { OverlayMessage, PageRequest, PageResponse } from '@datalabrotterdam/nova-ai-browser-protocol';

const MISSING_RECEIVER = /Receiving end does not exist|Could not establish connection/i;

async function injectContentScripts(tabId: number): Promise<void> {
    const files = (chrome.runtime.getManifest().content_scripts ?? []).flatMap((script) => script.js ?? []);
    try {
        await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files });
    } catch (error) {
        throw new Error(`Nova cannot run on this page: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function sendToTop<T>(tabId: number, message: object): Promise<T> {
    try {
        return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 }) as T;
    } catch (error) {
        if (!(error instanceof Error) || !MISSING_RECEIVER.test(error.message)) {
            throw error;
        }
    }
    await injectContentScripts(tabId);
    // Module content scripts load asynchronously after the loader runs; retry briefly.
    for (let attempt = 0; ; attempt++) {
        try {
            return await chrome.tabs.sendMessage(tabId, message, { frameId: 0 }) as T;
        } catch (error) {
            if (attempt >= 10 || !(error instanceof Error) || !MISSING_RECEIVER.test(error.message)) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
}

/** Sends a request to the page script; throws its error message on failure. */
export async function pageRequest<T>(tabId: number, request: PageRequest): Promise<T> {
    const response = await sendToTop<PageResponse<T> | undefined>(tabId, request);
    if (!response) {
        throw new Error('The page did not answer. It may still be loading; wait and try again.');
    }
    if (!response.ok) {
        throw new Error(response.error);
    }
    return response.value;
}

/** Sends a message to the overlay. Never throws: the overlay is cosmetic and must not break tools. */
export async function overlay(tabId: number, message: OverlayMessage, timeoutMs = 1_000): Promise<void> {
    await Promise.race([
        sendToTop(tabId, message).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, timeoutMs))
    ]);
}
