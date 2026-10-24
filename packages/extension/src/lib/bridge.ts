import {
    errorResult,
    PANEL_PORT,
    type PanelEvent,
    type PermissionDecision,
    type ToolCaller,
    type ToolResult
} from '@datalabrotterdam/nova-ai-browser-protocol';

/** Runs a browser tool in the service worker. */
export async function callTool(name: string, args: Record<string, unknown>, caller: ToolCaller): Promise<ToolResult> {
    try {
        const result = await chrome.runtime.sendMessage({ type: 'tool/call', name, args, caller }) as ToolResult | undefined;
        return result ?? errorResult('The extension did not return a result.');
    } catch (error) {
        return errorResult(`Tool call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function setAgentRunning(running: boolean): Promise<void> {
    await chrome.runtime.sendMessage({ type: 'agent/running', running }).catch(() => undefined);
}

export async function answerPermission(id: string, decision: PermissionDecision): Promise<void> {
    await chrome.runtime.sendMessage({ type: 'permission/answer', id, decision });
}

export async function addCurrentTab(): Promise<void> {
    const response = await chrome.runtime.sendMessage({ type: 'tabs/add-current' }) as { ok: boolean; error?: string };
    if (!response?.ok) throw new Error(response?.error ?? 'Could not add the tab.');
}

/** Keeps a port open to the service worker (it also tells the worker a panel is listening). */
export function connectPanel(onEvent: (event: PanelEvent) => void): () => void {
    let port: chrome.runtime.Port | undefined;
    let closed = false;

    const connect = () => {
        port = chrome.runtime.connect({ name: PANEL_PORT });
        port.onMessage.addListener(onEvent);
        // The service worker can restart; reconnect so permission prompts keep arriving.
        port.onDisconnect.addListener(() => {
            if (!closed) setTimeout(connect, 250);
        });
    };
    connect();

    return () => {
        closed = true;
        port?.disconnect();
    };
}
