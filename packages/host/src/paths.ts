import { mkdirSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';

/** Native messaging host name, registered with the browser. */
export const HOST_NAME = 'nl.datalabrotterdam.nova_ai_browser';

/** Development build ID (pinned by the manifest key). Store builds pass --extension-id. */
export const DEV_EXTENSION_ID = 'lnoimoijcjpcebjepmenoepmhbdgnipo';

/** The Nova home shared with nova-ai-vscode and nova-ai-cli. Override with NOVA_AI_HOME. */
export function novaHome(): string {
    return process.env.NOVA_AI_HOME?.trim() || join(homedir(), '.nova-ai');
}

/**
 * Where the host keeps its state. Override with NOVA_AI_BROWSER_HOME (used by tests).
 * Not under NOVA_AI_HOME: the browser starts the host without the environment the installer and
 * the agents have, and they must all agree on this folder (hosts/, screenshots/, sessions/).
 */
export function homeDir(): string {
    return process.env.NOVA_AI_BROWSER_HOME ?? join(homedir(), '.nova-ai', 'browser');
}

export function ensureHomeDir(): string {
    const dir = homeDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
}

/** One file per running host (several browsers can run one each). */
export function hostsDir(): string {
    return join(homeDir(), 'hosts');
}

export function hostInfoPath(pid: number): string {
    return join(hostsDir(), `${pid}.json`);
}

/** Copies of the extension's saved chats, one JSON file each (see sessions.ts). */
export function sessionsDir(): string {
    return join(homeDir(), 'sessions');
}

export function logPath(): string {
    return join(homeDir(), 'host.log');
}

/** A host's local socket for MCP shims and the skill script: a unix socket, or a named pipe on Windows. */
export function socketPath(pid: number): string {
    if (process.platform === 'win32') {
        return `\\\\.\\pipe\\nova-ai-browser-${userInfo().username}-${pid}`;
    }
    return join(hostsDir(), `${pid}.sock`);
}

/** What a running host publishes for clients (mode 0600). */
export interface HostInfo {
    pid: number;
    /** The browser that started this host, e.g. "Microsoft Edge" (from its process name). */
    browser?: string;
    version: string;
    socket: string;
    /** Streamable HTTP MCP endpoint, for ACP agents and other HTTP MCP clients. */
    mcpUrl: string;
    token: string;
    extensionOrigin: string;
    startedAt: string;
}
