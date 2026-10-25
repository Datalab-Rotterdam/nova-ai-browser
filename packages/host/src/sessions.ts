/**
 * Copies of the extension's saved chats, so agents can read past browser sessions from disk.
 * The extension is the source of truth: it sends every change, and a full sync when it connects.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sessionsDir } from './paths';

/** Ids come from the extension; anything else could escape the folder. */
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

function fileOf(id: unknown): string | undefined {
    return typeof id === 'string' && SAFE_ID.test(id) ? join(sessionsDir(), `${id}.json`) : undefined;
}

export function saveSession(session: unknown): void {
    const file = fileOf((session as { id?: unknown } | null)?.id);
    if (!file) return;
    mkdirSync(sessionsDir(), { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify(session, null, 2), { mode: 0o600 });
}

export function deleteSession(id: unknown): void {
    const file = fileOf(id);
    if (file) rmSync(file, { force: true });
}

/** Writes every session and removes files of sessions the extension no longer has. */
export function syncSessions(sessions: unknown): void {
    if (!Array.isArray(sessions)) return;
    sessions.forEach(saveSession);
    const kept = new Set(sessions.map((session) => fileOf(session?.id)));
    let names: string[];
    try {
        names = readdirSync(sessionsDir());
    } catch {
        return;
    }
    for (const name of names) {
        const file = join(sessionsDir(), name);
        if (name.endsWith('.json') && !kept.has(file)) rmSync(file, { force: true });
    }
}
