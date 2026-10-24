import { textResult, type ToolResult } from '@datalabrotterdam/nova-ai-browser-protocol';
import { loadSettings } from '../../lib/settings';
import { attach, clearConsole, clearNetwork, consoleEntries, networkEntries, send } from '../cdp';
import { untrusted } from './page';
import type { ToolContext } from './context';

function matcher(pattern: unknown): (text: string) => boolean {
    if (typeof pattern !== 'string' || !pattern) return () => true;
    try {
        const regex = new RegExp(pattern, 'i');
        return (text) => regex.test(text);
    } catch {
        const needle = pattern.toLowerCase();
        return (text) => text.toLowerCase().includes(needle);
    }
}

export async function readConsole(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    await attach(ctx.tabId);
    const matches = matcher(args.pattern);
    const entries = consoleEntries(ctx.tabId)
        .filter((entry) => !args.only_errors || entry.level === 'error' || entry.level === 'exception')
        .filter((entry) => matches(entry.text));
    if (args.clear) clearConsole(ctx.tabId);
    if (!entries.length) {
        return textResult('No console messages captured. Messages are recorded from the moment Nova attaches to the tab; reload the page to capture startup logs.');
    }
    const lines = entries.slice(-200).map((entry) => `[${entry.level}] ${entry.text.slice(0, 2_000)}${entry.url ? ` (${entry.url})` : ''}`);
    return textResult(untrusted(lines.join('\n')));
}

export async function readNetwork(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    await attach(ctx.tabId);
    const matches = matcher(args.url_pattern);
    const entries = networkEntries(ctx.tabId).filter((entry) => matches(entry.url ?? ''));
    if (args.clear) clearNetwork(ctx.tabId);
    if (!entries.length) {
        return textResult('No network requests captured. Requests are recorded from the moment Nova attaches to the tab.');
    }
    const lines = entries.slice(-200).map((entry) =>
        `${entry.method} ${entry.status ?? (entry.failed ? `FAILED ${entry.failed}` : 'pending')} ${entry.type ?? ''} ${entry.url.slice(0, 300)}`);
    return textResult(lines.join('\n'));
}

export async function javascript(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    if (!(await loadSettings()).allowJavascript) {
        throw new Error('javascript_tool is disabled. The user can enable it in Nova settings; use read_page, find or computer instead.');
    }
    if (typeof args.code !== 'string' || !args.code.trim()) throw new Error('javascript_tool needs `code`.');

    const response = await send<{ result: { type: string; value?: unknown; description?: string }; exceptionDetails?: { exception?: { description?: string }; text: string } }>(
        ctx.tabId,
        'Runtime.evaluate',
        { expression: args.code, returnByValue: true, awaitPromise: true, userGesture: true, replMode: true, timeout: 15_000 }
    );
    if (response.exceptionDetails) {
        throw new Error(`JavaScript error: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text}`);
    }
    const { result } = response;
    const value = result.value !== undefined
        ? (typeof result.value === 'string' ? result.value : JSON.stringify(result.value, null, 2))
        : (result.description ?? result.type);
    return textResult(untrusted(String(value).slice(0, 50_000)));
}
