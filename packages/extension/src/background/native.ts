/**
 * Connection to the native host (packages/host). When installed, it exposes this extension's
 * tools as an MCP server to VS Code, Claude Code and ACP agents. An open native port also
 * keeps the service worker alive, so external agents can call tools at any time.
 */
import { errorResult, identifyClient, type AgentClient, type ToolResult } from '@datalabrotterdam/nova-ai-browser-protocol';
import { allSessions } from '../lib/sessions';
import { loadSettings } from '../lib/settings';

export const HOST_NAME = 'nl.datalabrotterdam.nova_ai_browser';
const STATUS_KEY = 'hostStatus';
const NOT_INSTALLED_RETRY_MS = 30_000;

export interface HostStatus {
    state: 'connecting' | 'connected' | 'not-installed' | 'disconnected' | 'disabled';
    version?: string;
    mcpUrl?: string;
    error?: string;
}

type ToolRunner = (name: string, args: Record<string, unknown>, client: AgentClient) => Promise<ToolResult>;

let port: chrome.runtime.Port | undefined;
let runner: ToolRunner = async () => errorResult('Not ready.');
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retries = 0;

async function setStatus(status: HostStatus): Promise<void> {
    await chrome.storage.session.set({ [STATUS_KEY]: status });
}

export async function hostStatus(): Promise<HostStatus> {
    return ((await chrome.storage.session.get(STATUS_KEY))[STATUS_KEY] as HostStatus | undefined) ?? { state: 'disconnected' };
}

export function setToolRunner(fn: ToolRunner): void {
    runner = fn;
}

export function notifyHost(message: object): void {
    try {
        port?.postMessage(message);
    } catch {
        // Port already closed.
    }
}

let connecting: Promise<void> | undefined;

/**
 * Connects to the native host unless already connected. Concurrent calls (start-up and an
 * opening side panel) share one attempt: two ports would start two hosts.
 */
export function connectHost(): Promise<void> {
    if (port) return Promise.resolve();
    connecting ??= openPort().finally(() => {
        connecting = undefined;
    });
    return connecting;
}

async function openPort(): Promise<void> {
    clearTimeout(retryTimer);
    if (port) return;
    if (!(await loadSettings()).externalAgents) {
        await setStatus({ state: 'disabled' });
        return;
    }

    await setStatus({ state: 'connecting' });
    const current = chrome.runtime.connectNative(HOST_NAME);
    port = current;

    current.onMessage.addListener((message: Record<string, unknown>) => {
        if (message.type === 'hello') {
            retries = 0;
            void setStatus({ state: 'connected', version: String(message.version ?? ''), mcpUrl: String(message.mcpUrl ?? '') });
            // Chats saved while the host was away; the host also removes files of deleted chats.
            void allSessions().then((sessions) => notifyHost({ type: 'sessions/sync', sessions }));
        } else if (message.type === 'tool/call' && typeof message.id === 'string') {
            const id = message.id;
            const reported = message.client as Partial<AgentClient> | undefined;
            const client = identifyClient(reported?.name);
            void runner(String(message.name), (message.args ?? {}) as Record<string, unknown>, client).then((result) => {
                // userImage is for the side panel only; agents get the content.
                notifyHost({ type: 'tool/result', id, result: { content: result.content, isError: result.isError } });
            });
        }
    });

    current.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError?.message ?? '';
        if (port === current) port = undefined;
        if (/not found|forbidden|Specified native messaging host/i.test(error)) {
            void setStatus({ state: 'not-installed', error });
            // The user may install the host while the browser runs: keep checking now and then.
            retryTimer = setTimeout(() => void connectHost(), NOT_INSTALLED_RETRY_MS);
            return;
        }
        void setStatus({ state: 'disconnected', error: error || undefined });
        // The host crashed or was restarted: try again with backoff (5s, 10s, … up to 5 min).
        const delay = Math.min(300_000, 5_000 * 2 ** retries++);
        retryTimer = setTimeout(() => void connectHost(), delay);
    });
}

export async function disconnectHost(): Promise<void> {
    clearTimeout(retryTimer);
    const current = port;
    port = undefined;
    current?.disconnect();
    await setStatus({ state: (await loadSettings()).externalAgents ? 'disconnected' : 'disabled' });
}
