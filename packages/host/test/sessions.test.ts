import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessionsDir } from '../src/paths';
import { deleteSession, saveSession, syncSessions } from '../src/sessions';

describe('saved browser sessions', () => {
    let home: string;
    const saved = process.env.NOVA_AI_BROWSER_HOME;

    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), 'nova-sessions-'));
        process.env.NOVA_AI_BROWSER_HOME = home;
    });
    afterEach(() => {
        if (saved === undefined) delete process.env.NOVA_AI_BROWSER_HOME;
        else process.env.NOVA_AI_BROWSER_HOME = saved;
        rmSync(home, { recursive: true, force: true });
    });

    it('writes and deletes one file per session', () => {
        saveSession({ id: 'a-1', title: 'First' });
        expect(JSON.parse(readFileSync(join(sessionsDir(), 'a-1.json'), 'utf8')).title).toBe('First');
        deleteSession('a-1');
        expect(existsSync(join(sessionsDir(), 'a-1.json'))).toBe(false);
    });

    it('ignores ids that could leave the folder', () => {
        saveSession({ id: '../escape' });
        saveSession({ id: 'x/../../y' });
        deleteSession('../host.log');
        expect(existsSync(join(home, 'escape.json'))).toBe(false);
        expect(existsSync(sessionsDir())).toBe(false);
    });

    it('lives in ~/.nova-ai/browser, whatever NOVA_AI_HOME says', () => {
        delete process.env.NOVA_AI_BROWSER_HOME;
        const nova = process.env.NOVA_AI_HOME;
        process.env.NOVA_AI_HOME = home;
        expect(sessionsDir()).toBe(join(homedir(), '.nova-ai', 'browser', 'sessions'));
        if (nova === undefined) delete process.env.NOVA_AI_HOME;
        else process.env.NOVA_AI_HOME = nova;
    });

    it('sync keeps exactly the sessions the browser has', () => {
        saveSession({ id: 'old' });
        syncSessions([{ id: 'new' }, { id: 'kept' }]);
        expect(readdirSync(sessionsDir()).sort()).toEqual(['kept.json', 'new.json']);
    });
});
