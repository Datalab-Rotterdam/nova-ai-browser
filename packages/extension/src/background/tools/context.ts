import type { AgentClient, ToolCaller } from '@datalabrotterdam/nova-ai-browser-protocol';

/** Per-call context for tools that act on a tab. */
export interface ToolContext {
    tabId: number;
    tab: chrome.tabs.Tab;
    caller: ToolCaller;
    /** The external agent behind an mcp/acp call. */
    client?: AgentClient;
    /** The user already confirmed this call (a site rule asked), so the tool must not ask again. */
    actionConfirmed?: boolean;
}
