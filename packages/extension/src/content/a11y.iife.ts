/**
 * Page understanding for the agent: a compact accessibility tree with stable element refs,
 * element search, ref resolution to click points and form filling. Runs in the top frame and
 * walks into same-origin iframes and open shadow roots.
 */
import { formatTable, normalizeGrid } from '@datalabrotterdam/nova-ai-browser-protocol';
import type { FileInputInfo, LocatedBox, PageRequest, PageResponse, ResolvedRef, TableGrid } from '@datalabrotterdam/nova-ai-browser-protocol';

declare global {
    // eslint-disable-next-line no-var
    var __novaPageLoaded: boolean | undefined;
}

const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'checkbox', 'radio', 'switch', 'textbox', 'searchbox', 'combobox', 'listbox', 'option',
    'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'slider', 'spinbutton', 'treeitem', 'gridcell'
]);
const LANDMARK_ROLES = new Set(['main', 'navigation', 'banner', 'contentinfo', 'complementary', 'form', 'search', 'dialog', 'region']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK']);
const SENSITIVE_AUTOCOMPLETE = ['current-password', 'new-password', 'one-time-code', 'cc-number', 'cc-csc', 'cc-exp'];
const MAX_NAME = 100;

const refs = new Map<string, WeakRef<Element>>();
const elementRefs = new WeakMap<Element, string>();
let refCounter = 0;

function refFor(element: Element): string {
    let ref = elementRefs.get(element);
    if (!ref) {
        ref = `ref_${++refCounter}`;
        elementRefs.set(element, ref);
        refs.set(ref, new WeakRef(element));
    }
    return ref;
}

function elementForRef(ref: string): Element {
    const element = refs.get(ref.trim())?.deref();
    if (!element || !element.isConnected) {
        throw new Error(`${ref} no longer exists on the page. Call read_page or find again for fresh refs.`);
    }
    return element;
}

// ---------------------------------------------------------------------------------------------
// Roles and names

function roleOf(element: Element): string {
    const explicit = element.getAttribute('role')?.trim().split(/\s+/)[0];
    if (explicit) {
        return explicit;
    }

    const tag = element.tagName.toLowerCase();
    switch (tag) {
        case 'a': return element.hasAttribute('href') ? 'link' : 'generic';
        case 'button': case 'summary': return 'button';
        case 'select': return (element as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
        case 'textarea': return 'textbox';
        case 'option': return 'option';
        case 'img': return 'image';
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
        case 'nav': return 'navigation';
        case 'main': return 'main';
        case 'header': return 'banner';
        case 'footer': return 'contentinfo';
        case 'aside': return 'complementary';
        case 'form': return 'form';
        case 'dialog': return 'dialog';
        case 'ul': case 'ol': return 'list';
        case 'li': return 'listitem';
        case 'table': return 'table';
        case 'iframe': return 'iframe';
        case 'input': {
            const type = (element as HTMLInputElement).type;
            if (type === 'checkbox' || type === 'radio') return type;
            if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image' || type === 'file') return 'button';
            if (type === 'range') return 'slider';
            if (type === 'number') return 'spinbutton';
            if (type === 'search') return 'searchbox';
            return 'textbox';
        }
    }
    if ((element as HTMLElement).isContentEditable && !(element.parentElement as HTMLElement | null)?.isContentEditable) {
        return 'textbox';
    }
    return 'generic';
}

function collapse(text: string | null | undefined, max = MAX_NAME): string {
    const value = (text ?? '').replace(/\s+/g, ' ').trim();
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function textOfIds(element: Element, ids: string): string {
    const doc = element.ownerDocument;
    return ids.split(/\s+/).map((id) => doc.getElementById(id)?.textContent ?? '').join(' ');
}

function nameOf(element: Element): string {
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
        const text = collapse(textOfIds(element, labelledBy));
        if (text) return text;
    }
    const ariaLabel = collapse(element.getAttribute('aria-label'));
    if (ariaLabel) return ariaLabel;

    const tag = element.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        const control = element as HTMLInputElement;
        const label = control.labels?.[0];
        if (label) {
            const text = collapse(label.textContent);
            if (text) return text;
        }
        if (control.type === 'submit' || control.type === 'button' || control.type === 'reset') {
            return collapse(control.value);
        }
        return collapse(element.getAttribute('placeholder') || element.getAttribute('title') || element.getAttribute('name'));
    }
    if (tag === 'IMG') {
        return collapse(element.getAttribute('alt') || element.getAttribute('title'));
    }
    const text = collapse((element as HTMLElement).innerText ?? element.textContent);
    if (text) return text;
    const img = element.querySelector('img[alt], svg[aria-label]');
    return collapse(img?.getAttribute('alt') || img?.getAttribute('aria-label') || element.getAttribute('title'));
}

function isSensitive(element: Element): boolean {
    if (element.tagName !== 'INPUT') return false;
    const input = element as HTMLInputElement;
    const autocomplete = (input.getAttribute('autocomplete') ?? '').toLowerCase();
    return input.type === 'password' || input.type === 'hidden' || SENSITIVE_AUTOCOMPLETE.some((token) => autocomplete.includes(token));
}

function isInteractive(element: Element, role: string, style: CSSStyleDeclaration): boolean {
    if (INTERACTIVE_ROLES.has(role)) return true;
    const tag = element.tagName;
    if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'SUMMARY') return true;
    if ((element as HTMLElement).isContentEditable) return role === 'textbox';
    const tabindex = element.getAttribute('tabindex');
    if (tabindex !== null && Number(tabindex) >= 0) return true;
    if (element.hasAttribute('onclick')) return true;
    // Clickable divs: pointer cursor that does not come from a clickable parent.
    if (style.cursor === 'pointer') {
        const parent = element.parentElement;
        return !parent || getComputedStyle(parent).cursor !== 'pointer';
    }
    return false;
}

function stateOf(element: Element, role: string): string {
    const parts: string[] = [];
    const tag = element.tagName;

    if (tag === 'A') {
        const href = element.getAttribute('href');
        if (href && !href.startsWith('javascript:')) parts.push(`href="${collapse(href, 80)}"`);
    }
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
        const input = element as HTMLInputElement;
        if (tag === 'INPUT' && !['text', 'checkbox', 'radio', 'submit', 'button'].includes(input.type)) parts.push(`type=${input.type}`);
        if (role === 'checkbox' || role === 'radio') {
            parts.push(input.checked ? 'checked' : 'unchecked');
        } else if (input.type !== 'submit' && input.type !== 'button') {
            if (isSensitive(element)) {
                if (input.value) parts.push('value=[redacted]');
            } else if (input.value) {
                parts.push(`value="${collapse(input.value, 60)}"`);
            }
            const placeholder = input.getAttribute('placeholder');
            if (placeholder && collapse(placeholder) !== nameOf(element)) parts.push(`placeholder="${collapse(placeholder, 60)}"`);
        }
    }
    if (tag === 'SELECT') {
        const select = element as HTMLSelectElement;
        const selected = Array.from(select.selectedOptions).map((option) => collapse(option.text, 40));
        if (selected.length) parts.push(`selected="${selected.join(', ')}"`);
        const options = Array.from(select.options).slice(0, 12).map((option) => collapse(option.text, 30));
        parts.push(`options=[${options.join(' | ')}${select.options.length > 12 ? ` | …${select.options.length - 12} more` : ''}]`);
    }
    if (role === 'heading') {
        const level = /^H([1-6])$/.exec(tag)?.[1] ?? element.getAttribute('aria-level');
        if (level) parts.push(`level=${level}`);
    }
    for (const [attribute, label] of [['aria-checked', 'checked'], ['aria-expanded', 'expanded'], ['aria-selected', 'selected'], ['aria-pressed', 'pressed']] as const) {
        const value = element.getAttribute(attribute);
        if (value === 'true') parts.push(label);
        else if (value === 'false' && attribute !== 'aria-selected') parts.push(`not ${label}`);
    }
    if ((element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true') parts.push('disabled');
    if ((element as HTMLInputElement).required) parts.push('required');
    return parts.length ? ` ${parts.join(' ')}` : '';
}

// ---------------------------------------------------------------------------------------------
// Tree walking

interface Frame {
    /** Offset of this frame's viewport inside the top-level viewport. */
    offsetX: number;
    offsetY: number;
    viewportWidth: number;
    viewportHeight: number;
}

interface Visit {
    element: Element;
    frame: Frame;
    depth: number;
}

/** Children of an element including open shadow roots and same-origin iframe documents. */
function childrenOf(element: Element, frame: Frame): Array<{ element: Element; frame: Frame }> {
    if (element.tagName === 'IFRAME' || element.tagName === 'FRAME') {
        let doc: Document | null = null;
        try {
            doc = (element as HTMLIFrameElement).contentDocument;
        } catch {
            doc = null;
        }
        if (!doc?.documentElement) return [];
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const inner: Frame = {
            offsetX: frame.offsetX + rect.left + element.clientLeft + parseFloat(style.paddingLeft),
            offsetY: frame.offsetY + rect.top + element.clientTop + parseFloat(style.paddingTop),
            viewportWidth: doc.documentElement.clientWidth,
            viewportHeight: doc.documentElement.clientHeight
        };
        return doc.body ? [{ element: doc.body, frame: inner }] : [];
    }
    const result: Array<{ element: Element; frame: Frame }> = [];
    const shadow = (element as HTMLElement).shadowRoot;
    if (shadow) {
        for (const child of Array.from(shadow.children)) result.push({ element: child, frame });
    }
    for (const child of Array.from(element.children)) result.push({ element: child, frame });
    return result;
}

function topFrame(): Frame {
    return {
        offsetX: 0,
        offsetY: 0,
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: document.documentElement.clientHeight
    };
}

/** Frame (offset) for an element, found by climbing iframe and shadow hosts. */
function frameOf(element: Element): Frame {
    let offsetX = 0;
    let offsetY = 0;
    let win: Window | null = element.ownerDocument.defaultView;
    while (win && win !== window) {
        const host = win.frameElement;
        if (!host) break;
        const rect = host.getBoundingClientRect();
        const style = getComputedStyle(host);
        offsetX += rect.left + host.clientLeft + parseFloat(style.paddingLeft);
        offsetY += rect.top + host.clientTop + parseFloat(style.paddingTop);
        win = host.ownerDocument.defaultView;
    }
    const doc = element.ownerDocument.documentElement;
    return { offsetX, offsetY, viewportWidth: doc.clientWidth, viewportHeight: doc.clientHeight };
}

function isOffscreen(rect: DOMRect, frame: Frame): boolean {
    const top = window.innerHeight;
    const left = window.innerWidth;
    const x = rect.left + frame.offsetX;
    const y = rect.top + frame.offsetY;
    return y + rect.height < 0 || y > top || x + rect.width < 0 || x > left;
}

function directText(element: Element): string {
    let text = '';
    for (const node of Array.from(element.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
    }
    return collapse(text, 160);
}

function buildTree(root: Element, filter: 'interactive' | 'all', maxChars: number): string {
    const lines: string[] = [];
    let chars = 0;
    let omitted = 0;
    const stack: Visit[] = [{ element: root, frame: root === document.documentElement ? topFrame() : frameOf(root), depth: 0 }];

    while (stack.length) {
        const { element, frame, depth } = stack.pop()!;
        if (SKIP_TAGS.has(element.tagName) || element.id === 'nova-ai-overlay-host') continue;
        if (element.getAttribute('aria-hidden') === 'true') continue;

        const style = getComputedStyle(element);
        if (style.display === 'none') continue;

        const role = roleOf(element);
        const rect = element.getBoundingClientRect();
        const visible = style.visibility !== 'hidden' && style.visibility !== 'collapse' && (rect.width > 0 || rect.height > 0);
        const interactive = visible && isInteractive(element, role, style);
        let printed = false;

        if (visible) {
            let line: string | undefined;
            if (interactive) {
                line = `${role} "${nameOf(element)}" [${refFor(element)}]${stateOf(element, role)}`;
            } else if (filter === 'all') {
                if (role === 'heading' || role === 'image') {
                    const name = nameOf(element);
                    if (name) line = `${role} "${name}" [${refFor(element)}]${stateOf(element, role)}`;
                } else if (LANDMARK_ROLES.has(role)) {
                    const name = collapse(element.getAttribute('aria-label'));
                    line = name ? `${role} "${name}"` : role;
                } else if (role !== 'generic' && role !== 'listitem' && role !== 'list' || element.tagName === 'P' || element.tagName === 'LABEL') {
                    const text = directText(element);
                    if (text) line = `text "${text}"`;
                } else {
                    const text = directText(element);
                    if (text && text.length > 1) line = `text "${text}"`;
                }
            }

            if (line) {
                if (isOffscreen(rect, frame) && interactive) line += ' (offscreen)';
                const indented = `${'  '.repeat(filter === 'all' ? depth : 0)}${line}`;
                if (chars + indented.length > maxChars) {
                    omitted++;
                } else {
                    lines.push(indented);
                    chars += indented.length + 1;
                }
                printed = true;
            }
        }

        // Interactive elements with a name already describe their content.
        if (interactive && role !== 'generic' && element.tagName !== 'IFRAME' && role !== 'listbox' && role !== 'dialog') continue;

        const children = childrenOf(element, frame);
        const nextDepth = printed ? depth + 1 : depth;
        for (let i = children.length - 1; i >= 0; i--) {
            stack.push({ element: children[i].element, frame: children[i].frame, depth: nextDepth });
        }
    }

    if (omitted) {
        lines.push(`… ${omitted} more elements not shown (budget ${maxChars} chars). Use find, or read_page with a ref to read part of the page.`);
    }
    return lines.join('\n');
}

function pageHeader(): string {
    const scrollable = document.documentElement.scrollHeight > window.innerHeight + 1;
    const scroll = scrollable
        ? ` | scrolled ${Math.round(window.scrollY)}/${Math.round(document.documentElement.scrollHeight - window.innerHeight)}px`
        : '';
    return `Page: ${collapse(document.title, 120)} | ${location.href} | viewport ${window.innerWidth}x${window.innerHeight}${scroll}`;
}

// ---------------------------------------------------------------------------------------------
// Find

interface Candidate {
    element: Element;
    line: string;
    haystack: string;
    name: string;
    offscreen: boolean;
}

const ROLE_SYNONYMS: Record<string, string[]> = {
    textbox: ['input', 'field', 'box', 'text', 'textbox', 'textarea'],
    searchbox: ['search', 'input', 'field', 'box'],
    combobox: ['dropdown', 'select', 'combo', 'menu', 'picker'],
    button: ['button', 'btn'],
    link: ['link', 'anchor'],
    checkbox: ['checkbox', 'check', 'tick'],
    radio: ['radio', 'option'],
    tab: ['tab'],
    menuitem: ['menu', 'item']
};

function collectInteractive(): Candidate[] {
    const result: Candidate[] = [];
    const stack: Array<{ element: Element; frame: Frame }> = [{ element: document.documentElement, frame: topFrame() }];
    while (stack.length) {
        const { element, frame } = stack.pop()!;
        if (SKIP_TAGS.has(element.tagName) || element.id === 'nova-ai-overlay-host' || element.getAttribute('aria-hidden') === 'true') continue;
        const style = getComputedStyle(element);
        if (style.display === 'none') continue;
        const role = roleOf(element);
        const rect = element.getBoundingClientRect();
        if (style.visibility !== 'hidden' && (rect.width > 0 || rect.height > 0) && isInteractive(element, role, style)) {
            const name = nameOf(element);
            const extra = [element.getAttribute('placeholder'), element.getAttribute('title'), element.getAttribute('name'), element.id, element.getAttribute('type')]
                .filter(Boolean).join(' ');
            result.push({
                element,
                name: name.toLowerCase(),
                haystack: `${role} ${(ROLE_SYNONYMS[role] ?? []).join(' ')} ${name} ${extra}`.toLowerCase(),
                line: `${role} "${name}" [${refFor(element)}]${stateOf(element, role)}`,
                offscreen: isOffscreen(rect, frame)
            });
        }
        for (const child of childrenOf(element, frame)) stack.push(child);
    }
    return result;
}

function find(query: string, limit: number): string {
    const tokens = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 1 || /\d/.test(token));
    const phrase = query.toLowerCase().trim();
    const scored = collectInteractive()
        .map((candidate) => {
            let score = 0;
            for (const token of tokens) {
                if (candidate.name.includes(token)) score += 3;
                else if (candidate.haystack.includes(token)) score += 1;
            }
            if (phrase && candidate.name.includes(phrase)) score += 5;
            if (candidate.offscreen) score -= 0.5;
            return { candidate, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    if (!scored.length) {
        return `No interactive element matches "${query}". Try read_page, scroll, or a screenshot.`;
    }
    return scored.map(({ candidate }) => candidate.line + (candidate.offscreen ? ' (offscreen)' : '')).join('\n');
}

// ---------------------------------------------------------------------------------------------
// Refs → points

function describe(element: Element): string {
    const role = roleOf(element);
    const name = nameOf(element);
    if (role !== 'generic') return name ? `${role} "${collapse(name, 60)}"` : role;
    // Readable for the user (cursor label) and the model alike; the tag only matters without a name.
    if (name) return `"${collapse(name, 60)}"`;
    const id = element.id ? `#${element.id}` : '';
    const cls = typeof element.className === 'string' && element.className.trim()
        ? `.${element.className.trim().split(/\s+/).slice(0, 2).join('.')}`
        : '';
    return `<${element.tagName.toLowerCase()}${id}${cls}>`;
}

function resolve(ref: string, scroll: boolean): ResolvedRef {
    const element = elementForRef(ref);
    if (scroll) {
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    }

    const frame = frameOf(element);
    const rects = Array.from(element.getClientRects());
    const rect = rects.find((r) => r.width > 0 && r.height > 0) ?? element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
        throw new Error(`${ref} (${describe(element)}) is not visible.`);
    }

    // Clamp to the visible part of the element inside its own frame.
    const left = Math.max(rect.left, 0);
    const top = Math.max(rect.top, 0);
    const right = Math.min(rect.right, frame.viewportWidth);
    const bottom = Math.min(rect.bottom, frame.viewportHeight);
    if (right <= left || bottom <= top) {
        throw new Error(`${ref} (${describe(element)}) is outside the viewport. Use computer scroll_to with this ref first.`);
    }
    const localX = (left + right) / 2;
    const localY = (top + bottom) / 2;

    const result: ResolvedRef = {
        x: Math.round(localX + frame.offsetX),
        y: Math.round(localY + frame.offsetY),
        description: describe(element)
    };

    const hit = element.getRootNode() instanceof ShadowRoot
        ? (element.getRootNode() as ShadowRoot).elementFromPoint(localX, localY)
        : element.ownerDocument.elementFromPoint(localX, localY);
    const labelFor = hit instanceof HTMLLabelElement && hit.control === element;
    if (hit && hit !== element && !element.contains(hit) && !hit.contains(element) && !labelFor) {
        result.coveredBy = describe(hit);
    }
    return result;
}

function describePoint(x: number, y: number): string {
    let doc: Document = document;
    let localX = x;
    let localY = y;
    let hit = doc.elementFromPoint(localX, localY);
    // Descend into same-origin iframes and shadow roots.
    for (let guard = 0; hit && guard < 10; guard++) {
        if (hit.tagName === 'IFRAME') {
            let inner: Document | null = null;
            try {
                inner = (hit as HTMLIFrameElement).contentDocument;
            } catch {
                inner = null;
            }
            if (!inner) break;
            const rect = hit.getBoundingClientRect();
            localX -= rect.left + hit.clientLeft;
            localY -= rect.top + hit.clientTop;
            doc = inner;
            hit = doc.elementFromPoint(localX, localY);
            continue;
        }
        const shadowHit = (hit as HTMLElement).shadowRoot?.elementFromPoint(localX, localY);
        if (shadowHit && shadowHit !== hit) {
            hit = shadowHit;
            continue;
        }
        break;
    }
    if (!hit) return 'nothing';
    // Report the nearest interactive ancestor: clicks on an icon inside a button are clicks on the button.
    for (let element: Element | null = hit; element; element = element.parentElement) {
        if (isInteractive(element, roleOf(element), getComputedStyle(element))) {
            return describe(element);
        }
    }
    return describe(hit);
}

// ---------------------------------------------------------------------------------------------
// Form input

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
    const prototype = Object.getPrototypeOf(element) as object;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

function formInput(ref: string, value: string | number | boolean): string {
    const element = elementForRef(ref);
    if (isSensitive(element)) {
        throw new Error(`${ref} is a password or payment field. Ask the user to fill it in.`);
    }
    (element as HTMLElement).focus?.();

    if (element instanceof HTMLSelectElement) {
        const wanted = String(value).trim().toLowerCase();
        const option = Array.from(element.options).find((o) => o.value.toLowerCase() === wanted)
            ?? Array.from(element.options).find((o) => o.text.trim().toLowerCase() === wanted)
            ?? Array.from(element.options).find((o) => o.text.toLowerCase().includes(wanted));
        if (!option) {
            throw new Error(`No option "${value}" in ${describe(element)}. Options: ${Array.from(element.options).map((o) => o.text.trim()).join(' | ')}`);
        }
        setNativeValue(element, option.value);
        return `Selected "${option.text.trim()}" in ${describe(element)}.`;
    }

    if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
        const checked = value === true || String(value).toLowerCase() === 'true' || value === 1;
        if (element.checked !== checked) {
            element.click();
        }
        return `${describe(element)} is now ${element.checked ? 'checked' : 'unchecked'}.`;
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        setNativeValue(element, String(value));
        return `Set ${describe(element)} to "${collapse(String(value), 60)}".`;
    }

    if ((element as HTMLElement).isContentEditable) {
        element.textContent = String(value);
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
        return `Set ${describe(element)} to "${collapse(String(value), 60)}".`;
    }

    throw new Error(`${ref} (${describe(element)}) is not a form field. Use computer left_click and type instead.`);
}

// ---------------------------------------------------------------------------------------------
// Page text

function pageText(maxChars: number): string {
    const main = document.querySelector('main, [role="main"], article') as HTMLElement | null;
    const root = main && main.innerText.trim().length > 200 ? main : document.body;
    const text = (root?.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim();
    const header = `Title: ${document.title}\nURL: ${location.href}\n\n`;
    if (text.length <= maxChars) return header + text;
    return `${header}${text.slice(0, maxChars)}\n\n… truncated (${text.length - maxChars} more chars).`;
}

// ---------------------------------------------------------------------------------------------
// wait_for, extract_table, highlight, upload_file

/** Elements matching `test` in document order, through open shadow roots and same-origin iframes. */
function deepElements(test: (element: Element) => boolean): Element[] {
    const result: Element[] = [];
    const stack: Array<{ element: Element; frame: Frame }> = [{ element: document.documentElement, frame: topFrame() }];
    while (stack.length) {
        const { element, frame } = stack.pop()!;
        if (SKIP_TAGS.has(element.tagName) || element.id === 'nova-ai-overlay-host') continue;
        if (test(element)) result.push(element);
        const children = childrenOf(element, frame);
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
    return result;
}

function isVisible(element: Element): boolean {
    if (typeof element.checkVisibility === 'function' && !element.checkVisibility({ visibilityProperty: true })) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

function present(request: Extract<PageRequest, { type: 'page/present' }>): boolean {
    if (request.ref) {
        const element = refs.get(request.ref.trim())?.deref();
        return Boolean(element?.isConnected && isVisible(element));
    }
    if (request.selector) {
        const selector = request.selector;
        try {
            document.querySelector(selector);
        } catch {
            throw new Error(`Invalid CSS selector: ${selector}`);
        }
        if (Array.from(document.querySelectorAll(selector)).some(isVisible)) return true;
        return deepElements((element) => element.matches(selector)).some(isVisible);
    }
    if (request.text) {
        const needle = squash(request.text);
        if (squash(document.body?.innerText ?? '').includes(needle)) return true;
        // Same-origin iframes are not part of the top document's text.
        return deepElements((element) => element.tagName === 'BODY' && element.ownerDocument !== document)
            .some((body) => squash((body as HTMLElement).innerText).includes(needle));
    }
    throw new Error('Nothing to wait for.');
}

const TABLE_SELECTOR = 'table, [role="table"], [role="grid"], [role="treegrid"]';

function isTable(element: Element): boolean {
    const role = element.getAttribute('role');
    // A <table role="presentation"> is layout, not data.
    return role ? role === 'table' || role === 'grid' || role === 'treegrid' : element.tagName === 'TABLE';
}

function cellText(cell: Element): string {
    return collapse((cell as HTMLElement).innerText ?? cell.textContent, 500);
}

function htmlGrid(table: HTMLTableElement): TableGrid {
    const grid: string[][] = [];
    Array.from(table.rows).forEach((row, r) => {
        grid[r] ??= [];
        let c = 0;
        for (const cell of Array.from(row.cells)) {
            while (grid[r][c] !== undefined) c++;
            const text = cellText(cell);
            // Spanned cells repeat their text, so every row reads on its own.
            const colspan = Math.min(Math.max(cell.colSpan, 1), 50);
            const rowspan = Math.min(Math.max(cell.rowSpan, 1), 500);
            for (let dr = 0; dr < rowspan; dr++) {
                for (let dc = 0; dc < colspan; dc++) (grid[r + dr] ??= [])[c + dc] = text;
            }
            c += colspan;
        }
    });
    const first = table.rows[0];
    const header = Boolean(first && (first.parentElement?.tagName === 'THEAD' || (first.cells.length && Array.from(first.cells).every((cell) => cell.tagName === 'TH'))));
    return { rows: grid.map((row) => Array.from(row, (cell) => cell ?? '')), header };
}

function ariaGrid(table: Element): TableGrid {
    const rows = Array.from(table.querySelectorAll('[role="row"]')).filter((row) => row.parentElement?.closest(TABLE_SELECTOR) === table);
    const cellsOf = (row: Element) => Array.from(row.querySelectorAll('[role="cell"], [role="gridcell"], [role="columnheader"], [role="rowheader"]'))
        .filter((cell) => cell.closest('[role="row"]') === row);
    const first = rows[0] ? cellsOf(rows[0]) : [];
    return {
        rows: rows.map((row) => cellsOf(row).map(cellText)),
        header: first.length > 0 && first.every((cell) => cell.getAttribute('role') === 'columnheader')
    };
}

function gridOf(table: Element): TableGrid {
    const grid = table instanceof HTMLTableElement && !table.getAttribute('role') ? htmlGrid(table) : ariaGrid(table);
    return { rows: normalizeGrid(grid.rows), header: grid.header };
}

function tableName(table: Element, grid: TableGrid): string {
    const name = (table instanceof HTMLTableElement ? collapse(table.caption?.textContent, 80) : '') || collapse(nameOf(table), 80);
    if (name) return `"${name}"`;
    return grid.header && grid.rows[0] ? `columns: ${collapse(grid.rows[0].join(', '), 80)}` : 'no caption';
}

function extractTable(request: Extract<PageRequest, { type: 'page/table' }>): string {
    const all = deepElements(isTable);
    let target: Element | undefined;
    if (request.ref) {
        const element = elementForRef(request.ref);
        target = (isTable(element) ? element : element.closest(TABLE_SELECTOR) ?? element.querySelector(TABLE_SELECTOR)) ?? undefined;
        if (!target) throw new Error(`${request.ref} (${describe(element)}) is not in or around a table.`);
    } else if (request.index !== undefined) {
        target = all[Math.round(request.index) - 1];
        if (!target) throw new Error(`There is no table ${request.index}; the page has ${all.length}.`);
    }
    if (!target && !all.length) return 'No tables on this page. Use get_page_text or read_page instead.';

    const grids = new Map<Element, TableGrid>();
    const gridFor = (table: Element) => {
        let grid = grids.get(table);
        if (!grid) grids.set(table, grid = gridOf(table));
        return grid;
    };
    const size = (table: Element) => gridFor(table).rows.length * (gridFor(table).rows[0]?.length ?? 0);
    const chosen = target ?? all.reduce((best, table) => (size(table) > size(best) ? table : best));
    const grid = gridFor(chosen);
    if (!grid.rows.length) return 'The table is empty.';

    const keep = grid.rows.slice(0, request.maxRows + (grid.header ? 1 : 0));
    const dataRows = grid.rows.length - (grid.header ? 1 : 0);
    const number = all.indexOf(chosen) + 1;
    const lines = [
        `Table${number ? ` ${number} of ${all.length}` : ''} (${tableName(chosen, grid)}): ${dataRows} rows × ${grid.rows[0].length} columns.`,
        '',
        formatTable({ rows: keep, header: grid.header }, request.format)
    ];
    if (keep.length < grid.rows.length) lines.push('', `… ${grid.rows.length - keep.length} more rows; raise max_rows to get them.`);
    if (!target && all.length > 1) {
        lines.push('', 'Other tables on the page (pass index):');
        all.forEach((table, index) => {
            if (table === chosen) return;
            const other = gridFor(table);
            lines.push(`${index + 1}: ${tableName(table, other)}, ${other.rows.length} rows × ${other.rows[0]?.length ?? 0} columns`);
        });
    }
    return lines.join('\n');
}

/** The first visible text node range containing `text`, or the deepest element whose text contains it. */
function findText(text: string): { range?: Range; element: Element } | undefined {
    const needle = text.trim().toLowerCase();
    if (!needle || !document.body) return undefined;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        const at = (node.textContent ?? '').toLowerCase().indexOf(needle);
        if (at < 0 || !parent || parent.closest('#nova-ai-overlay-host, script, style, noscript') || !isVisible(parent)) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        return { range, element: parent };
    }
    // The text spans several nodes (e.g. "Total: <b>€ 12</b>"): narrow down to the deepest element holding all of it.
    const target = squash(text);
    let element: Element = document.body;
    if (!squash(document.body.innerText).includes(target)) return undefined;
    for (;;) {
        const child = Array.from(element.children).find((candidate) => isVisible(candidate) && squash((candidate as HTMLElement).innerText ?? '').includes(target));
        if (!child) return { element };
        element = child;
    }
}

function locate(request: Extract<PageRequest, { type: 'page/locate' }>): LocatedBox {
    let element: Element;
    let box: () => DOMRect;
    if (request.ref) {
        element = elementForRef(request.ref);
        box = () => element.getBoundingClientRect();
    } else {
        const found = request.text ? findText(request.text) : undefined;
        if (!found) throw new Error(`"${request.text ?? ''}" is not on the page (only the top page and visible text are searched).`);
        element = found.element;
        box = () => (found.range ?? element).getBoundingClientRect();
    }
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    const rect = box();
    if (rect.width === 0 && rect.height === 0) throw new Error(`${describe(element)} is not visible.`);
    const frame = frameOf(element);
    return {
        left: Math.round(rect.left + frame.offsetX),
        top: Math.round(rect.top + frame.offsetY),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        description: describe(element)
    };
}

function isFileInput(element: Element | null | undefined): element is HTMLInputElement {
    return element instanceof HTMLInputElement && element.type === 'file';
}

function fileInput(ref: string, token: string): FileInputInfo {
    const element = elementForRef(ref);
    let input: HTMLInputElement | undefined;
    if (isFileInput(element)) input = element;
    else if (element instanceof HTMLLabelElement && isFileInput(element.control)) input = element.control;
    else {
        // Upload buttons usually sit next to a hidden input: look inside, then a few levels up.
        for (let scope: Element | null = element, level = 0; scope && level < 4 && !input; scope = scope.parentElement, level++) {
            const candidate = scope.querySelector('input[type="file"]') ?? (scope as HTMLElement).shadowRoot?.querySelector('input[type="file"]');
            if (isFileInput(candidate)) input = candidate;
        }
        const all = input ? [] : deepElements(isFileInput);
        if (!input && all.length === 1) input = all[0] as HTMLInputElement;
    }
    if (!input) throw new Error(`${ref} (${describe(element)}) is not a file input and none is near it. Look for it with read_page filter=all.`);
    if (input.disabled) throw new Error(`The file input ${describe(input)} is disabled.`);
    input.setAttribute('data-nova-upload', token);
    return { description: describe(input), multiple: input.multiple, accept: input.accept };
}

// ---------------------------------------------------------------------------------------------

function handle(request: PageRequest): unknown {
    switch (request.type) {
        case 'page/tree': {
            const root = request.ref ? elementForRef(request.ref) : document.documentElement;
            const body = buildTree(root, request.filter, request.maxChars);
            return `${pageHeader()}\n${body || '(no matching elements)'}`;
        }
        case 'page/find':
            return find(request.query, request.limit);
        case 'page/resolve':
            return resolve(request.ref, request.scroll);
        case 'page/form-input':
            return formInput(request.ref, request.value);
        case 'page/text':
            return pageText(request.maxChars);
        case 'page/describe-point':
            return describePoint(request.x, request.y);
        case 'page/present':
            return present(request);
        case 'page/table':
            return extractTable(request);
        case 'page/locate':
            return locate(request);
        case 'page/file-input':
            return fileInput(request.ref, request.token);
    }
}

if (!globalThis.__novaPageLoaded) {
    globalThis.__novaPageLoaded = true;
    chrome.runtime.onMessage.addListener((message: PageRequest, _sender, sendResponse) => {
        if (typeof message?.type !== 'string' || !message.type.startsWith('page/')) {
            return false;
        }
        let response: PageResponse;
        try {
            response = { ok: true, value: handle(message) };
        } catch (error) {
            response = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        sendResponse(response);
        return false;
    });
}
