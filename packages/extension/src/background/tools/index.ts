/**
 * Single entry point for all browser tools, shared by the side panel agent, MCP and ACP
 * callers. Every call is checked against the Nova tab group and per-site permissions.
 */
import {
    errorResult,
    getToolDefinition,
    identifyClient,
    isReadOnlyCall,
    textResult,
    type ToolCallRequest,
    type ToolResult
} from '@datalabrotterdam/nova-ai-browser-protocol';
import { ensureAgentAllowed } from '../agents';
import { takeDialogNotes } from '../cdp';
import { ensureSiteAllowed } from '../permissions';
import { touch } from '../presence';
import { forgetGeometry } from '../screenshot';
import { createTab, describeTab, ensureGroup, focusTab, groupTabs, requireGroupTab, waitForLoad } from '../tabs';
import { computer } from './computer';
import type { ToolContext } from './context';
import { javascript, readConsole, readNetwork } from './devtools';
import { find, formInput, getPageText, readPage } from './page';

type TabTool = (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>;

const TAB_TOOLS: Record<string, TabTool> = {
    computer,
    read_page: readPage,
    find,
    form_input: formInput,
    get_page_text: getPageText,
    javascript_tool: javascript,
    read_console_messages: readConsole,
    read_network_requests: readNetwork
};

/** Tools that need the tab in front: input and screenshots only work reliably on a visible tab. */
const NEEDS_FOCUS = new Set(['computer', 'form_input']);

function normalizeUrl(url: string): string {
    const trimmed = url.trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
}

function summarize(name: string, args: Record<string, unknown>): string {
    if (name === 'computer') {
        const detail = args.text ? `: ${String(args.text).slice(0, 60)}` : args.ref ? ` ${args.ref}` : '';
        return `${String(args.action)}${detail}`;
    }
    if (name === 'navigate') return `open ${String(args.url)}`;
    return name.replace(/_/g, ' ');
}

async function tabsContext(): Promise<ToolResult> {
    await ensureGroup();
    const tabs = (await groupTabs()).map(describeTab);
    return textResult(JSON.stringify({ tabs, note: 'Only these tabs can be controlled. Use tabs_create for more.' }, null, 2));
}

async function navigate(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const raw = String(args.url ?? '').trim();
    if (!raw) throw new Error('navigate needs `url`.');
    forgetGeometry(ctx.tabId);

    if (raw === 'back' || raw === 'forward') {
        await (raw === 'back' ? chrome.tabs.goBack(ctx.tabId) : chrome.tabs.goForward(ctx.tabId));
    } else {
        const url = normalizeUrl(raw);
        await ensureSiteAllowed(url, 'navigate', `open ${url}`, ctx.caller, ctx.client);
        await chrome.tabs.update(ctx.tabId, { url });
    }
    const loaded = await waitForLoad(ctx.tabId);
    const tab = await chrome.tabs.get(ctx.tabId);
    return textResult(`${loaded ? 'Loaded' : 'Still loading'}: ${tab.title ?? ''} (${tab.url ?? raw})`);
}

/** Models write refs as 12, "12" or "[ref_12]"; tools expect "ref_12". */
function normalizeRef(value: unknown): unknown {
    if (typeof value === 'number' && Number.isInteger(value)) return `ref_${value}`;
    if (typeof value !== 'string') return value;
    const match = /^\[?(?:ref_?)?(\d+)\]?$/i.exec(value.trim());
    return match ? `ref_${match[1]}` : value;
}

async function run(request: ToolCallRequest): Promise<ToolResult> {
    const { name, caller } = request;
    const external = caller === 'mcp' || caller === 'acp';
    const client = external ? (request.client ?? identifyClient(undefined)) : undefined;
    const args = 'ref' in request.args ? { ...request.args, ref: normalizeRef(request.args.ref) } : request.args;
    if (!getToolDefinition(name)) {
        return errorResult(`Unknown tool "${name}".`);
    }
    // External agents need the user's go-ahead before they may use the browser at all.
    if (client) {
        await ensureAgentAllowed(client, name, summarize(name, args));
    }

    switch (name) {
        case 'tabs_context':
            return tabsContext();
        case 'tabs_create': {
            const url = typeof args.url === 'string' && args.url ? normalizeUrl(args.url) : undefined;
            if (url) await ensureSiteAllowed(url, name, `open ${url}`, caller, client);
            const tab = await createTab(url);
            if (url) await waitForLoad(tab.id!);
            return textResult(JSON.stringify(describeTab(await chrome.tabs.get(tab.id!))));
        }
        case 'tabs_close': {
            const tab = await requireGroupTab(args.tabId);
            await chrome.tabs.remove(tab.id!);
            return textResult(`Closed tab ${tab.id}.`);
        }
        case 'resize_window': {
            const tab = await requireGroupTab(args.tabId);
            const width = Math.round(Number(args.width));
            const height = Math.round(Number(args.height));
            if (!(width >= 200 && height >= 200)) throw new Error('width and height must be at least 200.');
            await chrome.windows.update(tab.windowId, { width, height, state: 'normal' });
            forgetGeometry(tab.id!);
            return textResult(`Resized the window to ${width}x${height}.`);
        }
    }

    const tab = await requireGroupTab(args.tabId);
    const ctx: ToolContext = { tabId: tab.id!, tab, caller, client };

    if (name !== 'navigate') {
        await ensureSiteAllowed(tab.url ?? '', name, summarize(name, args), caller, client);
    }
    if (NEEDS_FOCUS.has(name) || name === 'navigate') {
        await focusTab(tab);
    }
    await touch(ctx.tabId, client?.name);

    const result = name === 'navigate' ? await navigate(ctx, args) : await TAB_TOOLS[name](ctx, args);

    const notes = takeDialogNotes(ctx.tabId);
    if (notes.length) {
        result.content.push({ type: 'text', text: notes.join('\n') });
    }
    return result;
}

/** After the user presses Stop, external agents are refused for a while so they cannot carry on. */
let externalBlockedUntil = 0;
const STOP_BLOCK_MS = 30_000;

export function blockExternalCallers(): void {
    externalBlockedUntil = Date.now() + STOP_BLOCK_MS;
}

export async function callTool(request: ToolCallRequest): Promise<ToolResult> {
    if ((request.caller === 'mcp' || request.caller === 'acp') && Date.now() < externalBlockedUntil) {
        return errorResult('The user pressed Stop in the browser. Do not continue the browser task; ask the user what to do.');
    }
    try {
        return await run(request);
    } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
    }
}

export { isReadOnlyCall };
