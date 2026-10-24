/**
 * Shows the agent's presence (glow, cursor, Stop button) while it works and hides it after.
 * The side panel agent marks a whole run as active; MCP and ACP callers have no run, so each
 * tool call keeps the presence alive for a short idle window instead.
 */
import { overlay } from './content';
import { detachAll } from './cdp';
import { groupTabs } from './tabs';

const IDLE_MS = 20_000;

let runActive = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
/** Tab → name of the external agent working there (undefined for Nova in the side panel). */
const shownTabs = new Map<number, string | undefined>();

export function isRunActive(): boolean {
    return runActive;
}

export async function setRunActive(active: boolean): Promise<void> {
    runActive = active;
    if (active) {
        for (const tab of await groupTabs()) {
            if (tab.id !== undefined) await show(tab.id);
        }
    } else {
        await hideAll();
    }
}

async function show(tabId: number, agent?: string): Promise<void> {
    shownTabs.set(tabId, agent);
    await overlay(tabId, { type: 'overlay/show', agent });
}

/** Called for every tool call on a tab; `agent` names the external agent, if any. */
export async function touch(tabId: number, agent?: string): Promise<void> {
    if (!shownTabs.has(tabId) || shownTabs.get(tabId) !== agent) {
        await show(tabId, agent);
    }
    clearTimeout(idleTimer);
    if (!runActive) {
        idleTimer = setTimeout(() => void hideAll(), IDLE_MS);
    }
}

export async function hideAll(): Promise<void> {
    clearTimeout(idleTimer);
    const tabs = Array.from(shownTabs.keys());
    shownTabs.clear();
    await Promise.all(tabs.map((tabId) => overlay(tabId, { type: 'overlay/hide' })));
    // Detaching removes Chrome's "started debugging this browser" bar once Nova is done.
    await detachAll();
}

/** A navigation replaced the page (and its overlay); show it again on the new page. */
export async function restoreAfterNavigation(tabId: number): Promise<void> {
    if (shownTabs.has(tabId)) {
        await overlay(tabId, { type: 'overlay/show', agent: shownTabs.get(tabId) });
    }
}

export function forgetTab(tabId: number): void {
    shownTabs.delete(tabId);
}
