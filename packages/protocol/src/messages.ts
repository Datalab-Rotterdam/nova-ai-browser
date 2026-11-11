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
    /** Asked before every upload_file call; there is no "always". */
    | { type: 'permission/request'; id: string; kind: 'upload'; origin: string; files: string[]; tool: string; summary: string; agent?: string }
    /** Asked before a click on something that cannot be undone (pay, send, delete, ...); there is no "always". */
    | { type: 'permission/request'; id: string; kind: 'action'; origin: string; element: string; tool: string; summary: string; agent?: string }
    | { type: 'permission/resolved'; id: string; timedOut?: boolean }
    | { type: 'agent/stop'; reason: string }
    /** The toggle-panel shortcut was pressed while this panel is open: close it. */
    | { type: 'panel/close' }
    | { type: 'tool/activity'; caller: ToolCaller; name: string; args: Record<string, unknown>; result?: ToolResult };

export type PermissionDecision = 'once' | 'always' | 'deny';

export const PANEL_PORT = 'nova-panel';

/** First message a panel sends on its port, so the service worker knows which window it is in. */
export type PanelHello = { type: 'panel/hello'; windowId: number };

/** Service worker → page overlay content script. */
export type OverlayMessage =
    | { type: 'overlay/show'; agent?: string }
    | { type: 'overlay/hide' }
    | { type: 'overlay/move'; x: number; y: number; label?: string }
    | { type: 'overlay/press'; x: number; y: number; button: 'left' | 'right' | 'middle' }
    | { type: 'overlay/label'; label: string | null }
    | { type: 'overlay/capture-begin' }
    | { type: 'overlay/capture-end' }
    /** A box around something Nova points out, in viewport CSS pixels; removed after `ms` or on scroll. */
    | { type: 'overlay/highlight'; left: number; top: number; width: number; height: number; label?: string; ms: number }
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
    | { type: 'page/describe-point'; x: number; y: number }
    /** Whether `text`, `selector` or `ref` is present (visible); for wait_for. */
    | { type: 'page/present'; text?: string; selector?: string; ref?: string }
    | { type: 'page/table'; ref?: string; index?: number; format: TableFormat; maxRows: number }
    /** Scrolls an element or text into view and returns its box in top-viewport CSS pixels. */
    | { type: 'page/locate'; ref?: string; text?: string }
    /** Finds the file input for `ref` and marks it with `data-nova-upload="<token>"` for CDP. */
    | { type: 'page/file-input'; ref: string; token: string };

export type TableFormat = 'markdown' | 'csv' | 'json';

export interface LocatedBox {
    left: number;
    top: number;
    width: number;
    height: number;
    description: string;
}

export interface FileInputInfo {
    description: string;
    multiple: boolean;
    accept: string;
}

export interface ResolvedRef {
    /** Center of the element in CSS pixels of the top-level viewport. */
    x: number;
    y: number;
    description: string;
    /** Set when another element covers the center point. */
    coveredBy?: string;
}

export type PageResponse<T = unknown> = { ok: true; value: T } | { ok: false; error: string };
