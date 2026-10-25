import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liveHosts, pickHost } from '../src/hosts';
import { hostInfoPath, hostsDir, type HostInfo } from '../src/paths';

const host = (pid: number, startedAt: string, browser?: string): HostInfo => ({
    pid, browser, version: '0.1.0', socket: join(hostsDir(), `${pid}.sock`), mcpUrl: 'http://127.0.0.1:1/mcp', token: 't',
    extensionOrigin: 'chrome-extension://x/', startedAt
});

describe('running hosts (one per browser)', () => {
    let home: string;
    const saved = { ...process.env };
    beforeEach(() => {
        home = mkdtempSync(join(tmpdir(), 'nova-hosts-'));
        process.env.NOVA_AI_BROWSER_HOME = home;
        mkdirSync(hostsDir(), { recursive: true });
    });
    afterEach(() => {
        process.env = { ...saved };
        rmSync(home, { recursive: true, force: true });
    });

    it('lists live hosts newest first and removes files of hosts that are gone', () => {
        for (const info of [host(11, '2026-10-06T08:00:00Z', 'Microsoft Edge'), host(22, '2026-10-06T09:00:00Z', 'Google Chrome'), host(33, '2026-10-06T10:00:00Z')]) {
            writeFileSync(hostInfoPath(info.pid), JSON.stringify(info));
        }

        const hosts = liveHosts((pid) => pid !== 33);
        expect(hosts.map((info) => info.browser)).toEqual(['Google Chrome', 'Microsoft Edge']);
        expect(existsSync(hostInfoPath(33))).toBe(false);
    });

    it('picks the browser that connected last, or the pinned one', () => {
        const hosts = [host(22, '2026-10-06T09:00:00Z'), host(11, '2026-10-06T08:00:00Z')];
        expect(pickHost(hosts, undefined)?.pid).toBe(22);
        expect(pickHost(hosts, '11')?.pid).toBe(11);
        expect(pickHost(hosts, '99')).toBeUndefined();
        expect(pickHost([], undefined)).toBeUndefined();
    });
});
