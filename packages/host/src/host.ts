/**
 * The native messaging host, started by the browser when the extension connects. It bridges
 * MCP clients to the extension's browser tools:
 *
 *   MCP stdio shim ──unix socket / pipe──┐
 *                                        ├─► host ──native messaging──► extension tools
 *   HTTP MCP clients (ACP agents) ───────┘
 *
 * stdout carries the native messaging protocol, so nothing else may be written to it.
 */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createNetServer, type Server as NetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { errorResult, identifyClient, type AgentClient, type ToolResult } from '@datalabrotterdam/nova-ai-browser-protocol';
import { createMcpServer } from './mcpServer';
import { NativeChannel } from './native';
import { execFileSync } from 'node:child_process';
import { ensureHomeDir, hostInfoPath, hostsDir, logPath, socketPath, type HostInfo } from './paths';
import { onJsonLines, type RpcRequest, type RpcResponse } from './rpc';
import { deleteSession, saveSession, syncSessions } from './sessions';
import { VERSION } from './version';

/** Long enough for a permission prompt the user has to answer. */
const TOOL_TIMEOUT_MS = 200_000;

function log(message: string): void {
    try {
        appendFileSync(logPath(), `${new Date().toISOString()} [${process.pid}] ${message}\n`, { mode: 0o600 });
    } catch {
        // Logging must never break the host.
    }
}

function sameSecret(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
}

/** Name of the browser that started this host, from its process (macOS/Linux). */
function browserName(): string | undefined {
    if (process.platform === 'win32') return undefined;
    try {
        // The launcher script execs Node, so the parent is the browser itself.
        const command = execFileSync('ps', ['-o', 'comm=', '-p', String(process.ppid)], { encoding: 'utf8' }).trim();
        const app = /\/([^/]+)\.app\//.exec(command)?.[1] ?? command.split('/').pop();
        return app?.replace(/ Helper.*$/, '') || undefined;
    } catch {
        return undefined;
    }
}

export async function runHost(extensionOrigin: string): Promise<void> {
    ensureHomeDir();
    log(`started by ${extensionOrigin}`);

    const token = randomBytes(32).toString('base64url');
    const pending = new Map<string, { resolve(result: ToolResult): void; timer: NodeJS.Timeout }>();
    let shuttingDown = false;
    let netServer: NetServer | undefined;
    let httpServer: ReturnType<typeof createHttpServer> | undefined;

    const shutdown = (reason: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        log(`shutting down: ${reason}`);
        for (const [, entry] of pending) {
            clearTimeout(entry.timer);
            entry.resolve(errorResult('The browser (Nova AI extension) disconnected.'));
        }
        netServer?.close();
        httpServer?.close();
        // Only this host's own files: other browsers run hosts of their own.
        rmSync(hostInfoPath(process.pid), { force: true });
        if (process.platform !== 'win32') rmSync(socketPath(process.pid), { force: true });
        setTimeout(() => process.exit(0), 50).unref();
    };

    const channel = new NativeChannel(process.stdin, process.stdout, () => shutdown('browser closed the connection'));

    channel.onMessage((message) => {
        if (message.type === 'tool/result' && typeof message.id === 'string') {
            const entry = pending.get(message.id);
            if (entry) {
                pending.delete(message.id);
                clearTimeout(entry.timer);
                entry.resolve(message.result as ToolResult);
            }
        } else if (message.type === 'ping') {
            channel.send({ type: 'pong' });
        } else if (message.type === 'session/save' || message.type === 'session/delete' || message.type === 'sessions/sync') {
            try {
                if (message.type === 'session/save') saveSession(message.session);
                else if (message.type === 'session/delete') deleteSession(message.id);
                else syncSessions(message.sessions);
            } catch (error) {
                // The browser keeps the chats; a failed copy must not stop the host.
                log(`${message.type} failed: ${(error as Error).message}`);
            }
        }
    });

    const callTool = (name: string, args: Record<string, unknown>, client: AgentClient): Promise<ToolResult> => {
        if (shuttingDown) return Promise.resolve(errorResult('The browser is not connected.'));
        const id = randomUUID();
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                resolve(errorResult(`The browser did not answer ${name} within ${TOOL_TIMEOUT_MS / 1000}s.`));
            }, TOOL_TIMEOUT_MS);
            pending.set(id, { resolve, timer });
            channel.send({ type: 'tool/call', id, name, args, caller: 'mcp', client });
        });
    };

    // --- Local socket for the stdio MCP shim -----------------------------------------------
    mkdirSync(hostsDir(), { recursive: true, mode: 0o700 });
    const socket = socketPath(process.pid);
    if (process.platform !== 'win32' && existsSync(socket)) {
        // Left behind by a crashed host that had the same process id.
        rmSync(socket, { force: true });
    }
    netServer = createNetServer((connection) => {
        onJsonLines(connection, async (value) => {
            const request = value as RpcRequest;
            const reply = (response: Omit<RpcResponse, 'id'>) => connection.write(`${JSON.stringify({ ...response, id: request.id })}\n`);
            if (request.method === 'ping') {
                reply({ result: { ok: true, version: VERSION } });
            } else if (request.method === 'callTool' && request.params) {
                if (!sameSecret(request.params.token ?? '', token)) {
                    reply({ error: 'Invalid token.' });
                    return;
                }
                const client = request.params.client ?? identifyClient(undefined);
                const known = { ...identifyClient(client.name), ...(client.preApproved === true ? { preApproved: true } : {}) };
                reply({ result: await callTool(request.params.name, request.params.args ?? {}, known) });
            } else {
                reply({ error: 'Unknown method.' });
            }
        });
        connection.on('error', () => undefined);
    });
    await new Promise<void>((resolve, reject) => {
        netServer!.once('error', reject);
        netServer!.listen(socket, () => resolve());
    });
    if (process.platform !== 'win32') chmodSync(socket, 0o600);

    // --- Streamable HTTP MCP endpoint (sessions), for ACP agents and other HTTP clients ------
    const sessions = new Map<string, StreamableHTTPServerTransport>();
    httpServer = createHttpServer((req, res) => void handleHttp(req, res));
    async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const port = (httpServer!.address() as AddressInfo).port;
        // DNS rebinding and browser protection: only local hosts, no web origins, valid bearer token.
        const hostHeader = req.headers.host ?? '';
        const auth = req.headers.authorization ?? '';
        if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(hostHeader) || req.headers.origin) {
            res.writeHead(403).end();
            return;
        }
        if (!auth.startsWith('Bearer ') || !sameSecret(auth.slice(7), token)) {
            res.writeHead(401, { 'www-authenticate': 'Bearer' }).end();
            return;
        }
        if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/mcp') {
            res.writeHead(404).end();
            return;
        }
        // Stateful sessions: the client's name from `initialize` applies to all its later calls.
        const sessionId = req.headers['mcp-session-id'];
        const existing = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
        if (existing) {
            await existing.handleRequest(req, res);
            return;
        }
        if (sessionId) {
            res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null }));
            return;
        }
        const server = createMcpServer(callTool, 'HTTP MCP client');
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: (id) => {
                sessions.set(id, transport);
            }
        });
        transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
            void server.close();
        };
        await server.connect(transport);
        await transport.handleRequest(req, res);
    }
    await new Promise<void>((resolve) => httpServer!.listen(0, '127.0.0.1', () => resolve()));
    const port = (httpServer.address() as AddressInfo).port;

    const browser = browserName();
    const info: HostInfo = {
        pid: process.pid,
        ...(browser ? { browser } : {}),
        version: VERSION,
        socket,
        mcpUrl: `http://127.0.0.1:${port}/mcp`,
        token,
        extensionOrigin,
        startedAt: new Date().toISOString()
    };
    writeFileSync(hostInfoPath(process.pid), JSON.stringify(info, null, 2), { mode: 0o600 });
    chmodSync(hostInfoPath(process.pid), 0o600);

    channel.send({ type: 'hello', version: VERSION, mcpUrl: info.mcpUrl, socket });
    log(`ready: ${info.mcpUrl}, socket ${socket}`);

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('uncaughtException', (error) => {
        log(`uncaught: ${error.stack ?? error.message}`);
    });
}
