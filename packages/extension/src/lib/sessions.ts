/**
 * Saved chats. The browser is the source of truth (chrome.storage.local); the service worker
 * mirrors every change to the native host when it is connected, so agents can read past chats
 * from ~/.nova-ai/browser/sessions. Screenshots are not saved.
 */
import type { ChatMessage } from '@datalabrotterdam/nova-sdk';
import type { ChatItem } from '../sidepanel/chat.svelte';

export interface StoredSession {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    model: string;
    /** What the panel shows. */
    items: ChatItem[];
    /** What the model sees, without the system prompt. */
    history: ChatMessage[];
}

const INDEX_KEY = 'sessions';
const PREFIX = 'session:';
const KEPT_SESSIONS = 50;
const SCREENSHOT_PLACEHOLDER = { type: 'text', text: '[screenshot not saved]' };

const sessionKey = (id: string) => `${PREFIX}${id}`;

/** The session id of a storage key, if it is one. */
export function sessionIdOf(key: string): string | undefined {
    return key.startsWith(PREFIX) ? key.slice(PREFIX.length) : undefined;
}

/** A plain copy (no Svelte proxies) with tool screenshots and image parts replaced by a placeholder. */
export function withoutImages<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (_key, part) =>
        (part?.type === 'image' && 'data' in part) || part?.type === 'image_url' ? SCREENSHOT_PLACEHOLDER : part
    )) as T;
}

/** Ids, most recently updated first. */
async function sessionIds(): Promise<string[]> {
    return ((await chrome.storage.local.get(INDEX_KEY))[INDEX_KEY] ?? []) as string[];
}

export async function saveSession(session: StoredSession): Promise<void> {
    const ids = [session.id, ...(await sessionIds()).filter((id) => id !== session.id)];
    const dropped = ids.splice(KEPT_SESSIONS);
    await chrome.storage.local.set({ [sessionKey(session.id)]: withoutImages(session), [INDEX_KEY]: ids });
    if (dropped.length) await chrome.storage.local.remove(dropped.map(sessionKey));
}

export async function latestSession(): Promise<StoredSession | undefined> {
    const [id] = await sessionIds();
    return id ? (await chrome.storage.local.get(sessionKey(id)))[sessionKey(id)] as StoredSession | undefined : undefined;
}

export async function allSessions(): Promise<StoredSession[]> {
    const keys = (await sessionIds()).map(sessionKey);
    const stored = await chrome.storage.local.get(keys);
    return keys.map((key) => stored[key] as StoredSession | undefined).filter((session) => session !== undefined);
}
