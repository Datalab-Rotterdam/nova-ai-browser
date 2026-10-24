/**
 * Consent prompts. Two kinds:
 * - agent: before an external agent (VS Code, Claude Code, …) may use the browser at all;
 * - site: before Nova reads or acts on a site for the first time.
 * The user decides: allow (for this task or browser session), always allow, or deny. Prompts go
 * to the side panel when it is open, otherwise to a small popup window.
 */
import type { AgentClient, PanelEvent, PermissionDecision, ToolCaller } from '@datalabrotterdam/nova-ai-browser-protocol';
import { DEV_TOOLS } from '../lib/build';
import { loadSettings } from '../lib/settings';

const STORE_KEY = 'sitePermissions';
const SESSION_KEY = 'sessionSitePermissions';
const TIMEOUT_MS = 3 * 60_000;

type StoredDecision = 'always' | 'deny';

interface Pending {
    resolve(decision: PermissionDecision): void;
    windowId?: number;
}

const pending = new Map<string, Pending>();
let broadcast: (event: PanelEvent) => boolean = () => false;

/** Installs the function that delivers events to open side panels; returns whether any panel received it. */
export function setPanelBroadcast(fn: (event: PanelEvent) => boolean): void {
    broadcast = fn;
}

export function originOf(url: string): string | undefined {
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'file:') return 'file://';
        return /^https?:$/.test(parsed.protocol) ? parsed.origin : undefined;
    } catch {
        return undefined;
    }
}

export async function storedDecisions(): Promise<Record<string, StoredDecision>> {
    return ((await chrome.storage.local.get(STORE_KEY))[STORE_KEY] ?? {}) as Record<string, StoredDecision>;
}

export async function setStoredDecision(origin: string, decision: StoredDecision | undefined): Promise<void> {
    const all = await storedDecisions();
    if (decision) all[origin] = decision;
    else delete all[origin];
    await chrome.storage.local.set({ [STORE_KEY]: all });
}

async function sessionAllowed(): Promise<string[]> {
    return ((await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] ?? []) as string[];
}

/** Forgets "allow for this task" decisions; called when a side panel run ends. */
export async function clearSessionPermissions(): Promise<void> {
    await chrome.storage.session.remove(SESSION_KEY);
}

/**
 * Resolves when Nova may use `url`; throws a model-readable error when the user denies.
 * about:blank and similar pages need no consent.
 */
export async function ensureSiteAllowed(url: string, tool: string, summary: string, caller: ToolCaller, client?: AgentClient): Promise<void> {
    if (!url || url === 'about:blank') return;
    const origin = originOf(url);
    if (!origin) {
        throw new Error(`Nova cannot use ${url}: only http(s) and file pages can be controlled.`);
    }

    const stored = (await storedDecisions())[origin];
    if (stored === 'deny') {
        throw new Error(`The user blocked Nova on ${origin}. Do not try this site again; tell the user.`);
    }
    if (stored === 'always' || (await sessionAllowed()).includes(origin)) return;
    if (!(await loadSettings()).askBeforeActing || (DEV_TOOLS && caller === 'debug')) return;

    const decision = await requestDecision(`site:${origin}`, { kind: 'site', origin, tool, summary, agent: client?.name });
    if (decision === 'deny') {
        throw new Error(`The user did not allow Nova on ${origin}. Ask the user how to continue.`);
    }
    if (decision === 'always') {
        await setStoredDecision(origin, 'always');
    } else {
        await chrome.storage.session.set({ [SESSION_KEY]: [...await sessionAllowed(), origin] });
    }
}

type PromptDetails =
    | { kind: 'site'; origin: string; tool: string; summary: string; agent?: string }
    | { kind: 'agent'; client: AgentClient; tool: string; summary: string };

/** Shows one prompt per key; concurrent requests for the same key wait for the same answer. */
export function requestDecision(key: string, details: PromptDetails): Promise<PermissionDecision> {
    const existing = Array.from(pending.entries()).find(([id]) => id.startsWith(`${key}|`));
    if (existing) {
        return new Promise((resolve) => {
            const previous = existing[1].resolve;
            existing[1].resolve = (decision) => {
                previous(decision);
                resolve(decision);
            };
        });
    }

    const id = `${key}|${crypto.randomUUID()}`;
    return new Promise<PermissionDecision>((resolve) => {
        const entry: Pending = { resolve };
        pending.set(id, entry);

        const timer = setTimeout(() => answerPermission(id, 'deny'), TIMEOUT_MS);
        const originalResolve = entry.resolve;
        entry.resolve = (decision) => {
            clearTimeout(timer);
            originalResolve(decision);
        };

        const event = { type: 'permission/request', id, ...details } as PanelEvent;
        if (!broadcast(event)) {
            const params = new URLSearchParams({
                id,
                kind: details.kind,
                summary: details.summary,
                ...(details.kind === 'site'
                    ? { origin: details.origin, agent: details.agent ?? '' }
                    : { agent: details.client.name })
            });
            void chrome.windows.create({
                url: chrome.runtime.getURL(`src/permission/index.html?${params}`),
                type: 'popup',
                width: 440,
                height: 320,
                focused: true
            }).then((window) => {
                entry.windowId = window?.id;
            });
        }
    });
}

export function answerPermission(id: string, decision: PermissionDecision): void {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    entry.resolve(decision);
    broadcast({ type: 'permission/resolved', id });
    if (entry.windowId !== undefined) {
        void chrome.windows.remove(entry.windowId).catch(() => undefined);
    }
}

/** Denies everything still waiting, e.g. when the user presses Stop. */
export function denyAllPending(): void {
    for (const id of Array.from(pending.keys())) {
        answerPermission(id, 'deny');
    }
}

chrome.windows.onRemoved.addListener((windowId) => {
    for (const [id, entry] of pending) {
        if (entry.windowId === windowId) answerPermission(id, 'deny');
    }
});
