export function goto(href: string): Promise<void> {
    location.href = href;
    return Promise.resolve();
}
export function invalidateAll(): Promise<void> {
    return Promise.resolve();
}
