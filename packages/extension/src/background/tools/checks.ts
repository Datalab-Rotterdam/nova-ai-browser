/** Pure checks used by browser tools, kept free of chrome.* so they can be unit tested. */
import type { NetworkEntry } from '../cdp';

const MAX_FILES = 10;
const ABSOLUTE = /^(\/|[A-Za-z]:[\\/]|\\\\)/;

/** Checks the model's paths; throws a message the model can act on. */
export function parsePaths(value: unknown): string[] {
    const paths = (Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
        .filter((path): path is string => typeof path === 'string')
        .map((path) => path.trim())
        .filter(Boolean);
    if (!paths.length) throw new Error('upload_file needs `paths`: absolute paths of the files to attach.');
    if (paths.length > MAX_FILES) throw new Error(`At most ${MAX_FILES} files per upload.`);
    for (const path of paths) {
        if (path.startsWith('~')) throw new Error(`Write ${path} as an absolute path (without ~).`);
        if (!ABSOLUTE.test(path)) throw new Error(`${path} is not an absolute path.`);
    }
    return [...new Set(paths)];
}

/** No request started or pending for this long counts as network idle. */
const QUIET_MS = 500;
/** Requests open longer than this (long polling, event streams) do not keep the network busy. */
const LONG_LIVED_MS = 5_000;

/** Whether the network of a tab has been quiet, from the requests seen since Nova attached. */
export function isNetworkIdle(entries: readonly NetworkEntry[], now: number): boolean {
    return entries.every((entry) => now - entry.time >= QUIET_MS
        && (entry.done || entry.failed !== undefined || now - entry.time >= LONG_LIVED_MS));
}

/**
 * Words on a button or link that mean the click cannot be taken back (pay, send, delete, ...).
 * Matched against an element description such as `button "Place order"`; plain text boxes and
 * other roles never match, so typing into a "Send feedback to" field is not interrupted.
 */
const IRREVERSIBLE = /\b(pay|pay now|buy|buy now|purchase|place (?:your )?order|order now|complete (?:order|purchase)|checkout|check out|send|submit|delete|remove|confirm|transfer|withdraw|publish|post|donate|subscribe|book now|reserve|cancel (?:subscription|order|account)|close account|sign out everywhere)\b/i;
const ACTION_ROLES = /^(button|link|menuitem|menuitemcheckbox|switch|checkbox|option|tab)\b/;

/** The word that makes `description` look irreversible, or undefined. */
export function irreversibleAction(description: string): string | undefined {
    const text = description.trim();
    if (!ACTION_ROLES.test(text) && !/^"/.test(text)) return undefined;
    return text.match(IRREVERSIBLE)?.[0].toLowerCase();
}
