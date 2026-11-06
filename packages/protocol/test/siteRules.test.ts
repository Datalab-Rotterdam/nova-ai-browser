import { describe, expect, it } from 'vitest';
import { changesPage, matchSiteRule, parsePattern, type SiteRule } from '../src/siteRules';

const rule = (pattern: string, behavior: SiteRule['behavior'] = 'ask-actions'): SiteRule => ({ id: pattern, pattern, behavior });

describe('parsePattern', () => {
    it('reads hosts, wildcards and paths, and refuses junk', () => {
        expect(parsePattern('Example.com')).toEqual({ host: 'example.com', wildcard: false, path: '' });
        expect(parsePattern('https://*.shop.nl/account/*')).toEqual({ host: 'shop.nl', wildcard: true, path: '/account' });
        expect(parsePattern('localhost')).toBeTruthy();
        expect(parsePattern('')).toBeUndefined();
        expect(parsePattern('not a host')).toBeUndefined();
        expect(parsePattern('*.')).toBeUndefined();
    });
});

describe('matchSiteRule', () => {
    const rules = [rule('bank.nl', 'ask-actions'), rule('*.bank.nl', 'read-only'), rule('bank.nl/admin', 'block')];

    it('matches the exact host, subdomains with a wildcard and path prefixes', () => {
        expect(matchSiteRule(rules, 'https://bank.nl/')?.behavior).toBe('ask-actions');
        expect(matchSiteRule(rules, 'https://login.bank.nl/x')?.behavior).toBe('read-only');
        expect(matchSiteRule(rules, 'https://bank.nl/admin/users')?.behavior).toBe('block');
    });

    it('prefers the most specific rule and ignores near misses', () => {
        expect(matchSiteRule(rules, 'https://bank.nl/administrator')?.behavior).toBe('ask-actions');
        expect(matchSiteRule(rules, 'https://notbank.nl/')).toBeUndefined();
        expect(matchSiteRule(rules, 'https://bank.nl.evil.com/')).toBeUndefined();
    });

    it('ignores pages that are not http(s) and bad rules', () => {
        expect(matchSiteRule(rules, 'file:///etc/hosts')).toBeUndefined();
        expect(matchSiteRule(rules, 'about:blank')).toBeUndefined();
        expect(matchSiteRule([rule('not a host')], 'https://bank.nl/')).toBeUndefined();
    });
});

describe('changesPage', () => {
    it('separates reading and opening from changing', () => {
        expect(changesPage('read_page', {})).toBe(false);
        expect(changesPage('navigate', { url: 'https://x.nl' })).toBe(false);
        expect(changesPage('computer', { action: 'screenshot' })).toBe(false);
        expect(changesPage('computer', { action: 'left_click' })).toBe(true);
        expect(changesPage('form_input', {})).toBe(true);
        expect(changesPage('upload_file', {})).toBe(true);
    });
});
