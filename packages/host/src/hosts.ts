/**
 * Running hosts. Every browser with Nova AI connected runs its own host, which publishes
 * `hosts/<pid>.json`; clients (the MCP shim, the skill script, `status`) pick one of them.
 */
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { hostsDir, legacyHostInfoPath, type HostInfo } from './paths';

export function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        // ESRCH: gone. EPERM: another user's process, so never a host of ours.
        return false;
    }
}

/** Live hosts, newest first. Files of hosts that are gone (crash, kill) are removed. */
export function liveHosts(alive: (pid: number) => boolean = isAlive): HostInfo[] {
    rmSync(legacyHostInfoPath(), { force: true });
    let files: string[];
    try {
        files = readdirSync(hostsDir()).filter((name) => name.endsWith('.json'));
    } catch {
        return [];
    }
    const hosts: HostInfo[] = [];
    for (const name of files) {
        const file = join(hostsDir(), name);
        try {
            const info = JSON.parse(readFileSync(file, 'utf8')) as HostInfo;
            if (alive(info.pid)) {
                hosts.push(info);
                continue;
            }
            rmSync(file, { force: true });
            if (process.platform !== 'win32') rmSync(info.socket, { force: true });
        } catch {
            // Being written right now, or garbage: skip it.
        }
    }
    return hosts.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/**
 * The host to use: the one NOVA_AI_BROWSER_PID names, else the browser that connected last
 * (most likely the one the user is working in).
 */
export function pickHost(hosts: HostInfo[] = liveHosts(), pinned = process.env.NOVA_AI_BROWSER_PID): HostInfo | undefined {
    if (pinned) return hosts.find((host) => String(host.pid) === pinned.trim());
    return hosts[0];
}
