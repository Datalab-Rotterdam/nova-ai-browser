import { PANEL_PORT, type OverlayEvent, type PanelEvent, type PanelRequest } from '@datalabrotterdam/nova-ai-browser-protocol';
import { onDetach } from './cdp';
import { answerPermission, clearSessionPermissions, denyAllPending, setPanelBroadcast } from './permissions';
import { forgetTab, hideAll, isExternalAgentActive, isRunActive, restoreAfterNavigation, setRunActive } from './presence';
import { forgetGeometry } from './screenshot';
import { addTabToGroup, isInGroup, releaseGroup } from './tabs';
import { sessionIdOf } from '../lib/sessions';
import { onSettingsChanged } from '../lib/settings';
import { connectHost, disconnectHost, hostStatus, notifyHost, setToolRunner } from './native';
import { blockExternalCallers, callTool } from './tools';

const panels = new Set<chrome.runtime.Port>();
/** A panel that reconnects within this time was reloaded, not closed. */
const PANEL_RELOAD_MS = 3_000;
const stopListeners = new Set<(reason: string) => void>();

function broadcast(event: PanelEvent): boolean {
    for (const port of panels) {
        port.postMessage(event);
    }
    return panels.size > 0;
}

setPanelBroadcast(broadcast);

/** Stops whatever is driving the browser: the side panel run, and MCP/ACP callers through listeners. */
export async function stopAgent(reason: string): Promise<void> {
    denyAllPending();
    blockExternalCallers();
    notifyHost({ type: 'stop', reason });
    broadcast({ type: 'agent/stop', reason });
    for (const listener of stopListeners) listener(reason);
    await setRunActive(false);
    await clearSessionPermissions();
}

/**
 * The side panel's chat ended: close Nova's tabs, unless an external agent is still working in
 * them. External agents have no end of their own, so their tabs stay until then.
 */
async function releaseTabs(): Promise<void> {
    if (!isExternalAgentActive()) await releaseGroup();
}

export function onStop(listener: (reason: string) => void): void {
    stopListeners.add(listener);
}

// External agents (MCP/ACP) reach the tools through the native host.
setToolRunner((name, args, client) => callTool({ name, args, caller: 'mcp', client }));
void connectHost();
onSettingsChanged((settings) => {
    void (settings.externalAgents ? connectHost() : disconnectHost());
});

// Saved chats are mirrored to the host, so agents can read them from disk (see lib/sessions.ts).
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, change] of Object.entries(changes)) {
        const id = sessionIdOf(key);
        if (id) notifyHost(change.newValue ? { type: 'session/save', session: change.newValue } : { type: 'session/delete', id });
    }
});

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

/**
 * True for the extension's own pages (side panel, permission prompt, tool tester), whether they
 * are open in the panel, a popup or a tab. Content scripts also run as the extension but inside web
 * pages, so they only get to send `overlay/stop`.
 */
function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
    return sender.id === chrome.runtime.id && Boolean(sender.url?.startsWith(chrome.runtime.getURL('')));
}

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PANEL_PORT) return;
    if (!port.sender || !fromExtensionPage(port.sender)) {
        port.disconnect();
        return;
    }
    panels.add(port);
    // Opening the panel is a good moment to pick up a host installed since the last attempt.
    void connectHost();
    port.onDisconnect.addListener(() => {
        panels.delete(port);
        // Closing the panel ends its run.
        if (!panels.size && isRunActive()) {
            void stopAgent('The side panel was closed.');
        }
        // And its chat, unless it was only reloaded.
        setTimeout(() => {
            if (!panels.size) void releaseTabs();
        }, PANEL_RELOAD_MS);
    });
});

type ExtraRequest = { type: 'tabs/add-current' } | { type: 'tabs/release' } | { type: 'host/connect' } | { type: 'host/status' };

chrome.runtime.onMessage.addListener((message: PanelRequest | OverlayEvent | ExtraRequest, sender, sendResponse) => {
    if (message?.type !== 'overlay/stop' && !fromExtensionPage(sender)) return false;
    switch (message?.type) {
        case 'host/connect':
            void disconnectHost().then(connectHost).then(() => sendResponse({ ok: true }));
            return true;
        case 'host/status':
            void hostStatus().then(sendResponse);
            return true;
        case 'tool/call':
            void callTool({ name: message.name, args: message.args ?? {}, caller: message.caller }).then(sendResponse);
            return true;
        case 'permission/answer':
            answerPermission(message.id, message.decision);
            sendResponse({ ok: true });
            return false;
        case 'agent/running':
            void (message.running ? setRunActive(true) : setRunActive(false).then(clearSessionPermissions))
                .then(() => sendResponse({ ok: true }));
            return true;
        case 'overlay/stop':
            if (sender.tab) {
                void stopAgent('The user pressed Stop on the page.').then(() => sendResponse({ ok: true }));
                return true;
            }
            return false;
        case 'tabs/release':
            void releaseTabs().then(() => sendResponse({ ok: true }), (error: unknown) => sendResponse({ ok: false, error: String(error) }));
            return true;
        case 'tabs/add-current':
            void chrome.tabs.query({ active: true, lastFocusedWindow: true })
                .then(([tab]) => tab?.id !== undefined ? addTabToGroup(tab.id) : undefined)
                .then(() => sendResponse({ ok: true }), (error: unknown) => sendResponse({ ok: false, error: String(error) }));
            return true;
    }
    return false;
});

// A navigation replaces the page and its overlay; show it again while Nova is active.
chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'complete') {
        void isInGroup(tabId).then(async (inGroup) => {
            if (inGroup) await restoreAfterNavigation(tabId);
        });
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    forgetTab(tabId);
    forgetGeometry(tabId);
});

// The user dismissed Chrome's "started debugging" bar: treat it as Stop.
onDetach((_tabId, reason) => {
    if (reason === 'canceled_by_user') {
        void stopAgent('The user cancelled debugging in Chrome.');
    }
});

chrome.runtime.onSuspend?.addListener(() => {
    void hideAll();
});
