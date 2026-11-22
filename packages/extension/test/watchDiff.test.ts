import { describe, expect, it } from 'vitest';
import { comparePageContent } from '../src/lib/watchDiff';

describe('comparePageContent', () => {
    it('ignores reordering and accounts for repeated lines', () => {
        expect(comparePageContent(['A', 'B'], ['B', 'A'], 100)).toBeUndefined();
        expect(comparePageContent(['A', 'B'], ['B', 'A', 'A'], 100)).toEqual({
            at: 100, added: ['A'], removed: [], addedCount: 1, removedCount: 0
        });
    });

    it('keeps previews bounded while reporting the full number of changes', () => {
        const previous = ['old entry'];
        const current = ['a'.repeat(400), ...Array.from({ length: 10 }, (_, index) => `entry ${index}`)];
        const change = comparePageContent(previous, current, 100);
        expect(change).toMatchObject({ at: 100, addedCount: 11, removedCount: 1, removed: previous });
        expect(change?.added).toHaveLength(8);
        expect(change?.added[0]).toBe(`${'a'.repeat(300)}…`);
    });
});
