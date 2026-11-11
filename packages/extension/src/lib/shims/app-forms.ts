// client-lib's Form wraps SvelteKit form actions; the extension has none.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function enhance(..._args: any[]): { destroy(): void } {
    return { destroy() {} };
}
