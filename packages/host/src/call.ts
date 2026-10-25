/**
 * Shell access to the browser tools, used by the nova-browser skill:
 *
 *   nova-browser <tool> [key=value ...]     e.g. nova-browser computer tabId=12 action=left_click ref=ref_4
 *   nova-browser <tool> '<json object>'     e.g. nova-browser navigate '{"tabId": 12, "url": "example.com"}'
 *
 * Text results go to stdout. Images (screenshots, zooms) are saved as files and their paths
 * printed, so agents that can view image files can look at them.
 * Exit codes: 0 success, 1 the tool reported an error, 2 not connected or bad usage.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { getToolDefinition, identifyClient, TOOL_DEFINITIONS, type AgentClient, type ToolResult } from '@datalabrotterdam/nova-ai-browser-protocol';
import { pickHost } from './hosts';
import { homeDir } from './paths';
import { RpcClient } from './rpc';

export const NOT_CONNECTED = [
    'The Nova AI browser extension is not connected.',
    'Ask the user to open their browser (Chrome, Edge or Brave) with the Nova AI extension enabled.',
    'If it stays disconnected, the host needs to be installed once: `npx @datalabrotterdam/nova-ai-browser-host install`.'
].join(' ');

/** Parses `key=value` pairs (values as JSON when possible) or a single JSON object. */
export function parseCallArgs(parts: string[]): Record<string, unknown> {
    if (parts.length === 1 && parts[0].trim().startsWith('{')) {
        const parsed: unknown = JSON.parse(parts[0]);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('Arguments must be a JSON object.');
        }
        return parsed as Record<string, unknown>;
    }
    const args: Record<string, unknown> = {};
    for (const part of parts) {
        const equals = part.indexOf('=');
        if (equals <= 0) {
            throw new Error(`Expected key=value, got "${part}".`);
        }
        const key = part.slice(0, equals);
        const raw = part.slice(equals + 1);
        let value: unknown = raw;
        // Numbers, booleans, arrays and objects; text stays text (also text that merely looks like a word).
        if (/^(-?\d+(\.\d+)?|true|false|null|\[.*\]|\{.*\})$/s.test(raw.trim())) {
            try {
                value = JSON.parse(raw);
            } catch {
                value = raw;
            }
        }
        args[key] = value;
    }
    return args;
}

/** Shells, interpreters and wrappers between the agent app and this process. */
const WRAPPERS = /^(-?(sh|bash|zsh|fish|dash|ksh|tcsh|csh|pwsh|powershell|cmd)(\.exe)?|node(\.exe)?|npm|npx|env|sudo|login|script|timeout|nova-browser|tmux.*|screen)$/i;

const KNOWN_AGENT_IDS = new Set(['vscode', 'cursor', 'windsurf', 'claude-code', 'codex', 'nova-ai-cli', 'zed', 'jetbrains']);

/** Names of the ancestor processes, nearest first (macOS/Linux; empty elsewhere). */
function ancestorNames(maxDepth = 8): string[] {
    if (process.platform === 'win32') return [];
    const names: string[] = [];
    let pid = process.ppid;
    for (let depth = 0; depth < maxDepth && pid > 1; depth++) {
        try {
            const [ppid, ...command] = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/);
            names.push(basename(command.join(' ')));
            pid = Number(ppid);
        } catch {
            break;
        }
    }
    return names;
}

/**
 * Which app runs this command, so the user knows who asks for the browser: NOVA_BROWSER_CLIENT
 * when set, else the first ancestor process that is not a shell or wrapper (VS Code's extension
 * host, Claude Code, Codex, …).
 */
export function detectClient(names: string[] = ancestorNames(), override = process.env.NOVA_BROWSER_CLIENT): AgentClient {
    if (override?.trim()) return identifyClient(override);
    // A known agent anywhere up the tree wins (VS Code's helper may sit above a node process).
    const known = names.map((name) => identifyClient(name)).find((client) => KNOWN_AGENT_IDS.has(client.id));
    if (known) return known;
    const app = names.find((name) => !WRAPPERS.test(name));
    return app ? identifyClient(app) : { id: 'terminal', name: 'A terminal command' };
}

/** NOVA_BROWSER_PREAPPROVED=1: the app running this command already had the user approve it. */
export function callerClient(env: NodeJS.ProcessEnv = process.env): AgentClient {
    const client = detectClient(undefined, env.NOVA_BROWSER_CLIENT);
    return env.NOVA_BROWSER_PREAPPROVED === '1' ? { ...client, preApproved: true } : client;
}

export async function callHost(name: string, args: Record<string, unknown>, client: AgentClient = callerClient()): Promise<ToolResult | undefined> {
    const info = pickHost();
    if (!info) return undefined;
    let rpc: RpcClient;
    try {
        rpc = await RpcClient.connect(info.socket);
    } catch {
        return undefined;
    }
    try {
        const response = await rpc.request({ method: 'callTool', params: { name, args, token: info.token, client } }, 210_000);
        if (response.error) return { content: [{ type: 'text', text: response.error }], isError: true };
        return response.result as ToolResult;
    } finally {
        rpc.close();
    }
}

function saveImage(data: string, mimeType: string): string {
    const dir = join(homeDir(), 'screenshots');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const extension = mimeType.includes('png') ? 'png' : 'jpg';
    const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`);
    writeFileSync(file, Buffer.from(data, 'base64'), { mode: 0o600 });
    return file;
}

export function toolsReference(): string {
    const lines = ['# Nova AI Browser tools', '', 'Generated from the extension\'s tool definitions. Arguments are JSON Schema.', ''];
    for (const tool of TOOL_DEFINITIONS) {
        lines.push(`## ${tool.name}${tool.readOnly ? ' (read-only)' : ''}`, '', tool.description, '', '```json', JSON.stringify(tool.inputSchema, null, 2), '```', '');
    }
    return lines.join('\n');
}

export async function runCall(argv: string[]): Promise<number> {
    const [name, ...rest] = argv;
    if (!name || name === 'help' || name === '--help') {
        console.log('Usage: nova-browser <tool> [key=value ...] | nova-browser <tool> \'{"json": "args"}\'\n'
            + 'Tools: ' + TOOL_DEFINITIONS.map((tool) => tool.name).join(', ') + '\n'
            + 'Run `nova-browser tools` for every tool\'s arguments.');
        return name ? 0 : 2;
    }
    if (name === 'tools') {
        console.log(toolsReference());
        return 0;
    }
    if (!getToolDefinition(name)) {
        console.error(`Unknown tool "${name}". Tools: ${TOOL_DEFINITIONS.map((tool) => tool.name).join(', ')}`);
        return 2;
    }

    let args: Record<string, unknown>;
    try {
        args = parseCallArgs(rest);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 2;
    }

    const result = await callHost(name, args);
    if (!result) {
        console.error(NOT_CONNECTED);
        return 2;
    }
    for (const block of result.content) {
        if (block.type === 'text') {
            console.log(block.text);
        } else {
            console.log(`[image saved: ${saveImage(block.data, block.mimeType)}]`);
        }
    }
    return result.isError ? 1 : 0;
}
