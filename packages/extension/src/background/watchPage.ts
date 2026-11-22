import type { WatchTarget } from '../lib/watches';

type Request = { selection: string } | { target: WatchTarget } | { page: true };
export type WatchSnapshot = { value: string; target: WatchTarget } | { lines: string[] };
type Result = WatchSnapshot | { error: string };

/** Chrome serializes this function for injection into the top frame's isolated world. */
export function inspectWatchPage(url: string, request: Request): Result {
    const maxLength = 500;
    const missing = { error: 'The selected text could not be found on the current page. Try selecting it again.' };
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
    const unique = (root: ParentNode, selector: string, element: Element) => {
        const matches = root.querySelectorAll(selector);
        return matches.length === 1 && matches[0] === element;
    };
    const visible = (element: Element | undefined): element is HTMLElement => element instanceof HTMLElement && element.getClientRects().length > 0
        && getComputedStyle(element).visibility === 'visible' && !element.isContentEditable
        && !element.closest('input, textarea, select');

    function pageContent(): Result {
        const limit = 200_000;
        const maxLines = 4_000;
        const noise = 'nav, footer, aside, time, dialog, form, button, script, style, template, noscript, iframe, svg, '
            + '[role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="dialog"], '
            + '[role="alertdialog"], [role="alert"], [role="status"], [role="timer"], '
            + '[aria-hidden="true"], [hidden], [inert]';
        const root = Array.from(document.querySelectorAll('main, [role="main"]')).find(visible) ?? document.body;
        const lines: string[] = [];
        let buffer = '';
        let length = 0;
        let tooLarge = false;

        function flush() {
            const line = normalize(buffer);
            buffer = '';
            if (!line) return;
            length += line.length;
            tooLarge = length > limit || lines.length >= maxLines;
            if (!tooLarge) lines.push(line);
        }

        function visit(node: Node) {
            if (tooLarge) return;
            if (node.nodeType === Node.TEXT_NODE) {
                buffer += node.textContent ?? '';
                return;
            }
            if (!(node instanceof HTMLElement) || node.isContentEditable || node.matches(noise)) return;
            if (node.localName === 'header' && root === document.body && !node.closest('article, section')) return;
            const style = getComputedStyle(node);
            if (style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') return;
            const separatesLines = node.localName === 'br' || (!style.display.startsWith('inline') && style.display !== 'contents');
            if (separatesLines) flush();
            for (const child of node.childNodes) visit(child);
            if (separatesLines && !tooLarge) flush();
        }

        if (root) visit(root);
        if (!tooLarge) flush();
        if (tooLarge) return { error: 'This page has too much text to watch as a whole. Try watching selected text.' };
        if (!lines.length) return { error: 'Nova could not find visible page content to watch.' };
        return { lines };
    }

    function selectorFor(element: Element): string | undefined {
        const path: string[] = [];
        for (let node: Element | null = element; node; node = node.parentElement) {
            const tag = CSS.escape(node.localName);
            const id = node.id ? `#${CSS.escape(node.id)}` : undefined;
            const attributes = ['data-testid', 'data-test', 'data-qa', 'itemprop'].flatMap((name) => {
                const value = node!.getAttribute(name);
                return value ? [`${tag}[${name}="${CSS.escape(value)}"]`] : [];
            });
            const anchor = [id, ...attributes].find((candidate) => candidate && unique(document, candidate, node!));
            if (anchor) return [anchor, ...path].join(' > ');
            if (node === document.body) return ['body', ...path].join(' > ');

            const parent = node.parentElement;
            if (!parent) return undefined;
            const classes = Array.from(node.classList, (name) => `${tag}.${CSS.escape(name)}`);
            const segment = [`${tag}:only-of-type`, ...attributes, ...classes]
                .find((candidate) => unique(parent, `:scope > ${candidate}`, node!));
            if (!segment) return undefined;
            path.unshift(segment);
        }
        return undefined;
    }

    if (location.href !== url) return { error: 'The page redirected. Open the source page to check whether you need to sign in.' };

    if ('page' in request) return pageContent();

    if ('target' in request) {
        const { target } = request;
        const matches = document.querySelectorAll(target.selector);
        const element = matches[0];
        if (matches.length !== 1 || !visible(element)) return missing;
        const text = normalize(element.innerText);
        if (!text.startsWith(target.before) || !text.endsWith(target.after)) return missing;
        const value = text.slice(target.before.length, text.length - target.after.length).trim();
        return value && value.length <= maxLength ? { value, target } : missing;
    }

    const selection = window.getSelection();
    const value = normalize(request.selection);
    if (!value || value.length > maxLength) return { error: 'Select up to 500 characters to watch.' };
    if (!selection || selection.rangeCount !== 1 || normalize(selection.toString()) !== value) return missing;
    const node = selection.getRangeAt(0).commonAncestorContainer;
    const element = node instanceof Element ? node : node.parentElement;
    if (!element || element === document.body || element.getRootNode() !== document || !visible(element)) return missing;

    const text = normalize(element.innerText);
    const start = text.indexOf(value);
    if (start < 0 || text.lastIndexOf(value) !== start || text.length > maxLength * 2) {
        return { error: 'Select a single value or a short line of text to watch.' };
    }
    const selector = selectorFor(element);
    if (!selector) return { error: 'Nova could not identify this text reliably. Try selecting a different part of the page.' };
    return { value, target: { selector, before: text.slice(0, start), after: text.slice(start + value.length) } };
}
