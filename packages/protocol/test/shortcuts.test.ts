import { describe, expect, it } from 'vitest';
import { describeSchedule, expandShortcut, matchShortcuts, nextRun, NO_SCHEDULE, promptOf, shortcutProblem, slugifyName, type Shortcut } from '../src/shortcuts';

const shortcut = (name: string, extra: Partial<Shortcut> = {}): Shortcut => ({ id: name, name, prompt: `Do ${name}`, schedule: NO_SCHEDULE, ...extra });

describe('slugifyName', () => {
    it('makes a typed name usable', () => {
        expect(slugifyName('  /Daily News! ')).toBe('daily-news');
        expect(slugifyName('a'.repeat(40))).toHaveLength(32);
    });
});

describe('shortcutProblem', () => {
    it('accepts a good shortcut and explains the bad ones', () => {
        expect(shortcutProblem(shortcut('news'))).toBeUndefined();
        expect(shortcutProblem(shortcut('News!'))).toContain('short name');
        expect(shortcutProblem(shortcut('news'), [shortcut('news')])).toContain('already');
        expect(shortcutProblem(shortcut('news'), [shortcut('news')], 'news')).toBeUndefined();
        expect(shortcutProblem(shortcut('news', { prompt: ' ' }))).toContain('what Nova should do');
        expect(shortcutProblem(shortcut('news', { startUrl: 'example.com' }))).toContain('http');
        expect(shortcutProblem(shortcut('news', { schedule: { kind: 'daily', time: '25:00', weekday: 1 } }))).toContain('time');
    });
});

describe('expandShortcut and matchShortcuts', () => {
    const list = [shortcut('news', { startUrl: 'https://nos.nl' }), shortcut('nieuws'), shortcut('weather')];

    it('expands /name with the start page and what follows', () => {
        expect(expandShortcut('/news', list)).toBe('Start by opening https://nos.nl.\n\nDo news');
        expect(expandShortcut('/weather for Rotterdam', list)).toBe('Do weather\n\nfor Rotterdam');
        expect(expandShortcut('/unknown', list)).toBeUndefined();
        expect(expandShortcut('news', list)).toBeUndefined();
        expect(promptOf(list[1])).toBe('Do nieuws');
    });

    it('suggests by prefix while typing', () => {
        expect(matchShortcuts('/n', list).map((s) => s.name)).toEqual(['news', 'nieuws'].sort());
        expect(matchShortcuts('/', list)).toHaveLength(3);
        expect(matchShortcuts('/news extra', list)).toEqual([]);
        expect(matchShortcuts('hello', list)).toEqual([]);
    });
});

describe('nextRun', () => {
    // Local time: Wednesday 2026-11-04 10:30.
    const now = new Date(2026, 10, 4, 10, 30, 0).getTime();
    const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m, d, h, min, 0).getTime();

    it('is undefined when off', () => {
        expect(nextRun(NO_SCHEDULE, now)).toBeUndefined();
    });

    it('runs hourly at the given minute', () => {
        expect(nextRun({ kind: 'hourly', time: '09:45', weekday: 0 }, now)).toBe(at(2026, 10, 4, 10, 45));
        expect(nextRun({ kind: 'hourly', time: '09:15', weekday: 0 }, now)).toBe(at(2026, 10, 4, 11, 15));
    });

    it('runs daily today or tomorrow', () => {
        expect(nextRun({ kind: 'daily', time: '18:00', weekday: 0 }, now)).toBe(at(2026, 10, 4, 18, 0));
        expect(nextRun({ kind: 'daily', time: '09:00', weekday: 0 }, now)).toBe(at(2026, 10, 5, 9, 0));
    });

    it('runs weekly on the weekday', () => {
        expect(nextRun({ kind: 'weekly', time: '09:00', weekday: 1 }, now)).toBe(at(2026, 10, 9, 9, 0));
        expect(nextRun({ kind: 'weekly', time: '12:00', weekday: 3 }, now)).toBe(at(2026, 10, 4, 12, 0));
        expect(nextRun({ kind: 'weekly', time: '09:00', weekday: 3 }, now)).toBe(at(2026, 10, 11, 9, 0));
    });

    it('describes schedules', () => {
        expect(describeSchedule({ kind: 'weekly', time: '09:00', weekday: 1 })).toBe('Every Monday at 09:00');
        expect(describeSchedule(NO_SCHEDULE)).toBe('Not scheduled');
    });
});
