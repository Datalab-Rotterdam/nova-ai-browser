/**
 * upload_file: attaches local files to a file input through CDP (`DOM.setFileInputFiles`),
 * after the user confirmed the exact files. The content script marks the input with a one-off
 * token; the page's main world looks it up (through shadow roots and same-origin iframes).
 */
import { textResult, type FileInputInfo, type ToolResult } from '@datalabrotterdam/nova-ai-browser-protocol';
import { send } from '../cdp';
import { overlay, pageRequest } from '../content';
import { ensureUploadAllowed } from '../permissions';
import { parsePaths } from './checks';
import type { ToolContext } from './context';

interface RemoteObject {
    objectId?: string;
    value?: unknown;
    subtype?: string;
}

const findInput = (token: string) => `(() => {
    const selector = '[data-nova-upload="${token}"]';
    const search = (root) => {
        const hit = root.querySelector(selector);
        if (hit) return hit;
        for (const element of root.querySelectorAll('*')) {
            if (element.shadowRoot) {
                const inner = search(element.shadowRoot);
                if (inner) return inner;
            }
            if (element.tagName === 'IFRAME') {
                try {
                    const doc = element.contentDocument;
                    const inner = doc && search(doc);
                    if (inner) return inner;
                } catch {}
            }
        }
        return null;
    };
    return search(document);
})()`;

export async function uploadFile(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    if (typeof args.ref !== 'string') throw new Error('upload_file needs `ref` of the file input.');
    const paths = parsePaths(args.paths);

    const token = crypto.randomUUID();
    const input = await pageRequest<FileInputInfo>(ctx.tabId, { type: 'page/file-input', ref: args.ref, token });
    if (paths.length > 1 && !input.multiple) {
        throw new Error(`${input.description} takes one file; ${paths.length} were given.`);
    }

    await overlay(ctx.tabId, { type: 'overlay/label', label: 'Waiting for your OK to upload' });
    await ensureUploadAllowed(ctx.tab.url ?? '', paths, ctx.caller, ctx.client);
    await overlay(ctx.tabId, { type: 'overlay/label', label: 'Uploading' });

    const { result } = await send<{ result: RemoteObject }>(ctx.tabId, 'Runtime.evaluate', { expression: findInput(token) });
    if (!result.objectId || result.subtype === 'null') {
        throw new Error('The file input disappeared before the upload. Find it again and retry.');
    }
    try {
        await send(ctx.tabId, 'DOM.setFileInputFiles', { objectId: result.objectId, files: paths });
        const { result: attached } = await send<{ result: RemoteObject }>(ctx.tabId, 'Runtime.callFunctionOn', {
            objectId: result.objectId,
            functionDeclaration: 'function () { this.removeAttribute("data-nova-upload"); return Array.from(this.files || [], (file) => ({ name: file.name, size: file.size })); }',
            returnByValue: true
        });
        const files = (attached.value ?? []) as Array<{ name: string; size: number }>;
        const empty = files.filter((file) => file.size === 0).map((file) => file.name);
        return textResult([
            `Attached to ${input.description}: ${files.map((file) => `${file.name} (${formatSize(file.size)})`).join(', ') || paths.join(', ')}.`,
            ...(empty.length ? [`Warning: ${empty.join(', ')} ${empty.length === 1 ? 'is' : 'are'} empty; the path may be wrong.`] : []),
            ...(input.accept ? [`The input accepts: ${input.accept}.`] : []),
            'Check the page for a preview or an error before you submit.'
        ].join('\n'));
    } finally {
        void send(ctx.tabId, 'Runtime.releaseObject', { objectId: result.objectId }).catch(() => undefined);
    }
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
