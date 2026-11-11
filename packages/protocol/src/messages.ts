import type { AgentClient, ToolCaller, ToolResult } from './types';

/** Side panel (or debug UI) → service worker, via `chrome.runtime.sendMessage`. */
export type PanelRequest =
    | { type: 'tool/call'; name: string; args: Record<string, unknown>; caller: ToolCaller }
    | { type: 'permission/answer'; id: string; decision: PermissionDecision }
    | { type: 'agent/running'; running: boolean };

export type PanelResponse<T extends PanelRequest> =
    T extends { type: 'tool/call' } ? ToolResult : { ok: true };

/** Service worker → side panel, over the long-lived `nova-panel` port. */
export type PanelEvent =
    | { type: 'permission/request'; id: string; kind: 'site'; origin: string; tool: string; summary: string; agent?: string }
    | { type: 'permission/request'; id: string; kind: 'agent'; client: AgentClient; tool: string; summary: string }
    /** A click or form input on a control that is hard to undo (`isIrreversibleControl`); `summary` describes the element. */
    | { type: 'permission/request'; id: string; kind: 'action'; origin: string; tool: string; summary: string; agent?: string }
    | { type: 'permission/resolved'; id: string }
    | { type: 'agent/stop'; reason: string }
    | { type: 'tool/activity'; caller: ToolCaller; name: string; args: Record<string, unknown>; result?: ToolResult };

export type PermissionDecision = 'once' | 'always' | 'deny';

export const PANEL_PORT = 'nova-panel';

/** Service worker → page overlay content script. */
export type OverlayMessage =
    | { type: 'overlay/show'; agent?: string }
    | { type: 'overlay/hide' }
    | { type: 'overlay/move'; x: number; y: number; label?: string }
    | { type: 'overlay/press'; x: number; y: number; button: 'left' | 'right' | 'middle' }
    | { type: 'overlay/label'; label: string | null }
    | { type: 'overlay/capture-begin' }
    | { type: 'overlay/capture-end' }
    | { type: 'overlay/ping' };

/** Page overlay → service worker. */
export type OverlayEvent = { type: 'overlay/stop' };

/** Messages for the page-understanding content script (`a11y.ts`). */
export type PageRequest =
    | { type: 'page/tree'; filter: 'interactive' | 'all'; ref?: string; maxChars: number }
    | { type: 'page/find'; query: string; limit: number }
    | { type: 'page/resolve'; ref: string; scroll: boolean }
    | { type: 'page/form-input'; ref: string; value: string | number | boolean }
    | { type: 'page/text'; maxChars: number }
    | { type: 'page/describe-point'; x: number; y: number };

export interface ResolvedRef {
    /** Center of the element in CSS pixels of the top-level viewport. */
    x: number;
    y: number;
    description: string;
    /** Set when another element covers the center point. */
    coveredBy?: string;
}

export type PageResponse<T = unknown> = { ok: true; value: T } | { ok: false; error: string };
