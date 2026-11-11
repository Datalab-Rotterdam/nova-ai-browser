import { describe, expect, it } from 'vitest';
import type { NetworkEntry } from '../src/background/cdp';
import { irreversibleAction, isNetworkIdle, parsePaths } from '../src/background/tools/checks';
import { parseTodos, todosText } from '../src/sidepanel/agent/todos';

describe('parsePaths (upload_file)', () => {
    it('accepts absolute paths, one string or a list, without duplicates', () => {
        expect(parsePaths('/Users/ada/cv.pdf')).toEqual(['/Users/ada/cv.pdf']);
        expect(parsePaths([' C:\\Users\\ada\\cv.pdf ', 'C:\\Users\\ada\\cv.pdf', '/tmp/a.png'])).toEqual(['C:\\Users\\ada\\cv.pdf', '/tmp/a.png']);
    });

    it('refuses relative, home-relative, missing and too many paths', () => {
        expect(() => parsePaths(['cv.pdf'])).toThrow('not an absolute path');
        expect(() => parsePaths(['~/cv.pdf'])).toThrow('without ~');
        expect(() => parsePaths([])).toThrow('needs `paths`');
        expect(() => parsePaths(Array.from({ length: 11 }, (_, i) => `/f${i}`))).toThrow('At most 10');
    });
});

describe('isNetworkIdle (wait_for)', () => {
    const entry = (age: number, extra: Partial<NetworkEntry> = {}): NetworkEntry => ({ requestId: String(age), method: 'GET', url: 'https://x.test', time: 10_000 - age, ...extra });

    it('is idle when every request finished at least 500 ms ago', () => {
        expect(isNetworkIdle([], 10_000)).toBe(true);
        expect(isNetworkIdle([entry(800, { done: true }), entry(600, { failed: 'net::ERR' })], 10_000)).toBe(true);
    });

    it('is busy with a recent or pending request, but not for a long-lived one', () => {
        expect(isNetworkIdle([entry(200, { done: true })], 10_000)).toBe(false);
        expect(isNetworkIdle([entry(1_000)], 10_000)).toBe(false);
        expect(isNetworkIdle([entry(6_000)], 10_000)).toBe(true);
    });
});

describe('parseTodos (todo_write)', () => {
    it('cleans the list and defaults unknown statuses to pending', () => {
        const todos = parseTodos({ todos: [{ content: ' Open shop ', status: 'completed' }, { content: 'Compare', status: 'in_progress' }, { content: 'Report', status: 'later' }] });
        expect(todos).toEqual([
            { content: 'Open shop', status: 'completed' },
            { content: 'Compare', status: 'in_progress' },
            { content: 'Report', status: 'pending' }
        ]);
        expect(todosText(todos)).toBe('Task list updated: 1/3 done; in progress: Compare.');
    });

    it('rejects a list without content', () => {
        expect(() => parseTodos({ todos: 'x' })).toThrow('must be an array');
        expect(() => parseTodos({ todos: [{ status: 'pending' }] })).toThrow('Todo 1 needs a "content"');
    });
});

describe('irreversibleAction (click confirmation)', () => {
    it('flags buttons and links that pay, send or delete', () => {
        expect(irreversibleAction('button "Place order"')).toBe('place order');
        expect(irreversibleAction('button "Pay now"')).toBe('pay');
        expect(irreversibleAction('link "Delete account"')).toBe('delete');
        expect(irreversibleAction('button "Send"')).toBe('send');
        expect(irreversibleAction('"Submit"')).toBe('submit');
        expect(irreversibleAction('checkbox "Subscribe to our newsletter"')).toBe('subscribe');
    });

    it('lets ordinary clicks and text fields through', () => {
        expect(irreversibleAction('button "Search"')).toBeUndefined();
        expect(irreversibleAction('link "Pricing"')).toBeUndefined();
        expect(irreversibleAction('textbox "Send feedback to"')).toBeUndefined();
        expect(irreversibleAction('<div.card>')).toBeUndefined();
        expect(irreversibleAction('button "Payment methods"')).toBeUndefined();
    });
});
