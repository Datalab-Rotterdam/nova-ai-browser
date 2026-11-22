import type { PageContentChange } from './watches';

const PREVIEW_LINES = 8;
const PREVIEW_LENGTH = 300;

function unmatchedLines(from: readonly string[], against: readonly string[]) {
    const remaining = new Map<string, number>();
    for (const line of against) remaining.set(line, (remaining.get(line) ?? 0) + 1);

    let count = 0;
    const lines: string[] = [];
    for (const line of from) {
        const matches = remaining.get(line) ?? 0;
        if (matches > 0) {
            remaining.set(line, matches - 1);
            continue;
        }
        count++;
        if (lines.length < PREVIEW_LINES) lines.push(line.length > PREVIEW_LENGTH ? `${line.slice(0, PREVIEW_LENGTH)}…` : line);
    }
    return { count, lines };
}

/** Ignore reordering and count repeated lines so a newly repeated item is still a change. */
export function comparePageContent(previous: readonly string[], current: readonly string[], at: number): PageContentChange | undefined {
    const added = unmatchedLines(current, previous);
    const removed = unmatchedLines(previous, current);
    if (added.count === 0 && removed.count === 0) return undefined;
    return { at, added: added.lines, removed: removed.lines, addedCount: added.count, removedCount: removed.count };
}
