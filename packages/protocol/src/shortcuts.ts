/** Saved prompts ("shortcuts"): run from the composer with /name, or on a schedule. */

export type ScheduleKind = 'off' | 'hourly' | 'daily' | 'weekly';

export interface Schedule {
    kind: ScheduleKind;
    /** Local time "HH:MM" for daily and weekly runs; hourly runs use the minute. */
    time: string;
    /** 0 (Sunday) to 6, for weekly runs. */
    weekday: number;
}

export interface Shortcut {
    id: string;
    /** Lower-case letters, digits and dashes: typed as /name. */
    name: string;
    prompt: string;
    /** Opened first, when given. */
    startUrl?: string;
    schedule: Schedule;
}

export const NO_SCHEDULE: Schedule = { kind: 'off', time: '09:00', weekday: 1 };

const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** A name as typed by the user, made usable: "Daily News!" -> "daily-news". */
export function slugifyName(text: string): string {
    return text.trim().toLowerCase().replace(/^\/+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
}

/** What is wrong with a shortcut, in words for the user; undefined when it is fine. */
export function shortcutProblem(shortcut: Pick<Shortcut, 'name' | 'prompt' | 'startUrl' | 'schedule'>, others: readonly Shortcut[] = [], ownId?: string): string | undefined {
    if (!NAME.test(shortcut.name)) return 'Give it a short name with letters, digits and dashes, like daily-news.';
    if (others.some((other) => other.id !== ownId && other.name === shortcut.name)) return `There is already a shortcut called /${shortcut.name}.`;
    if (!shortcut.prompt.trim()) return 'Write what Nova should do.';
    if (shortcut.startUrl?.trim() && !/^https?:\/\/\S+$/i.test(shortcut.startUrl.trim())) return 'The start page must be a web address starting with http:// or https://.';
    if (shortcut.schedule.kind !== 'off' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(shortcut.schedule.time)) return 'Pick a time for the schedule.';
    return undefined;
}

/**
 * The text to send for a message that starts with /name: the shortcut's prompt (and start page)
 * followed by anything the user typed after the name. Undefined when the text is not a shortcut.
 */
export function expandShortcut(text: string, shortcuts: readonly Shortcut[]): string | undefined {
    const match = /^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (!match) return undefined;
    const shortcut = shortcuts.find((candidate) => candidate.name === match[1]);
    return shortcut ? promptOf(shortcut, match[2]?.trim()) : undefined;
}

/** The message a shortcut sends. */
export function promptOf(shortcut: Shortcut, extra?: string): string {
    const parts = [shortcut.startUrl?.trim() ? `Start by opening ${shortcut.startUrl.trim()}.` : '', shortcut.prompt.trim(), extra ?? ''];
    return parts.filter(Boolean).join('\n\n');
}

/** Shortcuts whose name starts with what the user typed after the "/". */
export function matchShortcuts(typed: string, shortcuts: readonly Shortcut[]): Shortcut[] {
    const match = /^\/([a-z0-9-]*)$/.exec(typed);
    if (!match) return [];
    return shortcuts.filter((shortcut) => shortcut.name.startsWith(match[1])).sort((a, b) => a.name.localeCompare(b.name));
}

/** The next time (ms since epoch, local time) a schedule runs after `now`; undefined when it is off. */
export function nextRun(schedule: Schedule, now: number): number | undefined {
    if (schedule.kind === 'off') return undefined;
    const [hours, minutes] = schedule.time.split(':').map(Number);
    const base = new Date(now);
    if (schedule.kind === 'hourly') {
        const next = new Date(now);
        next.setMinutes(minutes, 0, 0);
        if (next.getTime() <= now) next.setHours(next.getHours() + 1);
        return next.getTime();
    }
    const next = new Date(base);
    next.setHours(hours, minutes, 0, 0);
    if (schedule.kind === 'daily') {
        if (next.getTime() <= now) next.setDate(next.getDate() + 1);
        return next.getTime();
    }
    const ahead = (schedule.weekday - next.getDay() + 7) % 7;
    next.setDate(next.getDate() + ahead);
    if (next.getTime() <= now) next.setDate(next.getDate() + 7);
    return next.getTime();
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Every day at 09:00", for the list. */
export function describeSchedule(schedule: Schedule): string {
    switch (schedule.kind) {
        case 'off': return 'Not scheduled';
        case 'hourly': return `Every hour at :${schedule.time.slice(3)}`;
        case 'daily': return `Every day at ${schedule.time}`;
        case 'weekly': return `Every ${DAYS[schedule.weekday] ?? 'week'} at ${schedule.time}`;
    }
}
