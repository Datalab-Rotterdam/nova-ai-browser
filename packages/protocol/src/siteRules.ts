import { isReadOnlyCall } from './tools';

/**
 * What Nova does on matching sites, on top of the global approval mode:
 * - ask-actions: confirm every click, fill, upload and script before it runs;
 * - read-only: open and read pages, never change them;
 * - block: never use the site.
 */
export type SiteRuleBehavior = 'ask-actions' | 'read-only' | 'block';

export const SITE_RULE_BEHAVIORS: ReadonlyArray<{ value: SiteRuleBehavior; label: string; hint: string }> = [
    { value: 'ask-actions', label: 'Ask before acting', hint: 'Nova may read, but asks before every click, fill, upload or script.' },
    { value: 'read-only', label: 'Read only', hint: 'Nova may open and read pages, never change them.' },
    { value: 'block', label: 'Block', hint: 'Nova never uses this site.' }
];

export interface SiteRule {
    id: string;
    /** `example.com`, `*.example.com` (subdomains and the domain itself) or `example.com/admin` (a path prefix). */
    pattern: string;
    behavior: SiteRuleBehavior;
}

interface ParsedPattern {
    host: string;
    wildcard: boolean;
    path: string;
}

/** Splits a pattern such as `https://*.shop.nl/account/*`; undefined when it is not usable. */
export function parsePattern(pattern: string): ParsedPattern | undefined {
    const text = pattern.trim().toLowerCase().replace(/^https?:\/\//, '');
    if (!text || /\s/.test(text)) return undefined;
    const slash = text.indexOf('/');
    const hostPart = slash === -1 ? text : text.slice(0, slash);
    const path = slash === -1 ? '' : text.slice(slash).replace(/\/?\*?$/, '');
    const wildcard = hostPart.startsWith('*.');
    const host = wildcard ? hostPart.slice(2) : hostPart;
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) && host !== 'localhost') return undefined;
    return { host, wildcard, path };
}

/** How specific a match is: longer host, then longer path, wins. */
function specificity(parsed: ParsedPattern): number {
    return parsed.host.length * 1000 + parsed.path.length + (parsed.wildcard ? 0 : 1);
}

/** The most specific rule for `url`, or undefined (also for pages that are not http(s)). */
export function matchSiteRule(rules: readonly SiteRule[], url: string): SiteRule | undefined {
    let target: URL;
    try {
        target = new URL(url);
    } catch {
        return undefined;
    }
    if (!/^https?:$/.test(target.protocol)) return undefined;
    const host = target.hostname.toLowerCase();
    const path = target.pathname.toLowerCase();

    let best: { rule: SiteRule; score: number } | undefined;
    for (const rule of rules) {
        const parsed = parsePattern(rule.pattern);
        if (!parsed) continue;
        const hostMatches = parsed.wildcard ? host === parsed.host || host.endsWith(`.${parsed.host}`) : host === parsed.host;
        const pathMatches = !parsed.path || path === parsed.path || path.startsWith(`${parsed.path}/`);
        if (!hostMatches || !pathMatches) continue;
        const score = specificity(parsed);
        if (!best || score > best.score) best = { rule, score };
    }
    return best?.rule;
}

/** Opening and closing tabs is allowed in read-only situations: pages have to be opened to be read. */
const OPENING = new Set(['navigate', 'tabs_create', 'tabs_close']);

/** Whether a call changes a page (click, typing, form fill, upload, script), as opposed to reading or opening one. */
export function changesPage(name: string, args: Record<string, unknown>): boolean {
    return !OPENING.has(name) && !isReadOnlyCall(name, args);
}
