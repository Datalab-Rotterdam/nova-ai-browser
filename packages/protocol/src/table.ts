/** Formatting for extract_table: a grid of cell texts as Markdown, CSV or JSON. */
import type { TableFormat } from './messages';

export interface TableGrid {
    /** Rows of cell texts; all rows have the same length. */
    rows: string[][];
    /** The first row holds column headers. */
    header: boolean;
}

/** Pads rows to the same width and drops rows and trailing columns that are empty. */
export function normalizeGrid(rows: string[][]): string[][] {
    const filled = rows.filter((row) => row.some((cell) => cell.trim()));
    let width = Math.max(0, ...filled.map((row) => row.length));
    while (width > 0 && filled.every((row) => !(row[width - 1] ?? '').trim())) width--;
    return filled.map((row) => Array.from({ length: width }, (_, index) => (row[index] ?? '').trim()));
}

function csvCell(value: string): string {
    return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function markdownCell(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>') || ' ';
}

/** Header names for JSON keys: empty ones get a column name, duplicates a suffix. */
function keys(header: string[]): string[] {
    const seen = new Map<string, number>();
    return header.map((name, index) => {
        const base = name || `column_${index + 1}`;
        const count = (seen.get(base) ?? 0) + 1;
        seen.set(base, count);
        return count === 1 ? base : `${base}_${count}`;
    });
}

export function formatTable(grid: TableGrid, format: TableFormat): string {
    const { rows, header } = grid;
    if (!rows.length) return '';
    if (format === 'csv') {
        return rows.map((row) => row.map(csvCell).join(',')).join('\n');
    }
    if (format === 'json') {
        if (!header) return JSON.stringify(rows, null, 1);
        const names = keys(rows[0]);
        return JSON.stringify(rows.slice(1).map((row) => Object.fromEntries(names.map((name, index) => [name, row[index]]))), null, 1);
    }
    const head = header ? rows[0] : rows[0].map((_, index) => `Column ${index + 1}`);
    const body = header ? rows.slice(1) : rows;
    return [
        `| ${head.map(markdownCell).join(' | ')} |`,
        `| ${head.map(() => '---').join(' | ')} |`,
        ...body.map((row) => `| ${row.map(markdownCell).join(' | ')} |`)
    ].join('\n');
}
