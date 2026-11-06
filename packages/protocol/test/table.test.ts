import { describe, expect, it } from 'vitest';
import { formatTable, normalizeGrid } from '../src/table';

describe('normalizeGrid', () => {
    it('pads short rows and drops empty rows and trailing empty columns', () => {
        expect(normalizeGrid([[' Name ', 'Price', ''], ['Milk', '1.20'], ['', '  '], ['Bread', '2.50', '']]))
            .toEqual([['Name', 'Price'], ['Milk', '1.20'], ['Bread', '2.50']]);
    });
});

describe('formatTable', () => {
    const grid = { rows: [['Name', 'Note'], ['Milk', 'a "fresh", cold\none'], ['Bread', 'x | y']], header: true };

    it('writes Markdown with escaped pipes and line breaks', () => {
        expect(formatTable(grid, 'markdown')).toBe([
            '| Name | Note |',
            '| --- | --- |',
            '| Milk | a "fresh", cold<br>one |',
            '| Bread | x \\| y |'
        ].join('\n'));
    });

    it('writes CSV with quoting', () => {
        expect(formatTable(grid, 'csv')).toBe('Name,Note\nMilk,"a ""fresh"", cold\none"\nBread,x | y');
    });

    it('writes JSON objects keyed by unique header names', () => {
        const rows = JSON.parse(formatTable({ rows: [['A', '', 'A'], ['1', '2', '3']], header: true }, 'json'));
        expect(rows).toEqual([{ A: '1', column_2: '2', A_2: '3' }]);
    });

    it('numbers the columns of a table without header', () => {
        expect(formatTable({ rows: [['1', '2']], header: false }, 'markdown')).toBe('| Column 1 | Column 2 |\n| --- | --- |\n| 1 | 2 |');
        expect(JSON.parse(formatTable({ rows: [['1', '2']], header: false }, 'json'))).toEqual([['1', '2']]);
    });
});
