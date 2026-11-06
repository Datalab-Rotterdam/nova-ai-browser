/**
 * wait_for: polls the page until text or an element appears (or disappears) and, optionally,
 * until the network is quiet. Saves the model from repeating `wait` and screenshots.
 */
import { textResult, type ToolResult } from '@datalabrotterdam/nova-ai-browser-protocol';
import { attach, networkEntries } from '../cdp';
import { isNetworkIdle } from './checks';
import { overlay, pageRequest } from '../content';
import type { ToolContext } from './context';
import { clampNumber } from './page';

const POLL_MS = 300;
function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

export async function waitFor(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const text = typeof args.text === 'string' && args.text.trim() ? args.text.trim() : undefined;
    const selector = typeof args.selector === 'string' && args.selector.trim() ? args.selector.trim() : undefined;
    const ref = typeof args.ref === 'string' && args.ref.trim() ? args.ref.trim() : undefined;
    const gone = args.gone === true;
    const networkIdle = args.network_idle === true;
    if (!text && !selector && !ref && !networkIdle) {
        throw new Error('wait_for needs `text`, `selector`, `ref` or `network_idle`.');
    }
    const seconds = clampNumber(args.timeout, 10, 1, 30);
    const what = [
        text ? `"${text}"` : selector ? selector : ref,
        text || selector || ref ? (gone ? 'to disappear' : 'to appear') : undefined,
        networkIdle ? `${text || selector || ref ? 'and ' : ''}the network to go quiet` : undefined
    ].filter(Boolean).join(' ');
    await overlay(ctx.tabId, { type: 'overlay/label', label: `Waiting for ${what}`.slice(0, 48) });
    if (networkIdle) await attach(ctx.tabId);

    const start = Date.now();
    const deadline = start + seconds * 1000;
    let lastError: string | undefined;
    for (;;) {
        let elementOk = true;
        if (text || selector || ref) {
            try {
                const present = await timeout(pageRequest<boolean>(ctx.tabId, { type: 'page/present', text, selector, ref }), 2_000);
                elementOk = present !== gone;
                lastError = undefined;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                // A bad selector will not fix itself; anything else (navigation, loading) may.
                if (message.startsWith('Invalid CSS selector')) throw error;
                elementOk = false;
                lastError = message;
            }
        }
        const now = Date.now();
        if (elementOk && (!networkIdle || isNetworkIdle(networkEntries(ctx.tabId), now))) {
            return textResult(`Done waiting after ${((now - start) / 1000).toFixed(1)} s: ${what}.`);
        }
        if (now >= deadline) {
            throw new Error(`Timed out after ${seconds} s waiting for ${what}.${lastError && lastError !== 'timeout' ? ` Last error: ${lastError}` : ''} Take a screenshot or read_page to see what the page shows.`);
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
}
