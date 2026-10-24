/**
 * Minimal JSON-lines RPC between the stdio MCP shim and the running host, over a unix socket
 * or named pipe. One request type: run a tool.
 */
import { createConnection, type Socket } from 'node:net';
import type { AgentClient, ToolResult } from '@datalabrotterdam/nova-ai-browser-protocol';

export interface RpcRequest {
    id: number;
    method: 'callTool' | 'ping';
    params?: { name: string; args: Record<string, unknown>; token: string; client?: AgentClient };
}

export interface RpcResponse {
    id: number;
    result?: ToolResult | { ok: true; version: string };
    error?: string;
}

/** Splits a stream into lines and parses each as JSON. */
export function onJsonLines(socket: Socket, handler: (value: unknown) => void): void {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line) {
                try {
                    handler(JSON.parse(line));
                } catch {
                    // Ignore malformed lines; the peer gets no answer and times out.
                }
            }
        }
    });
}

export class RpcClient {
    private nextId = 1;
    private readonly pending = new Map<number, { resolve(value: RpcResponse): void; reject(error: Error): void }>();

    private constructor(private readonly socket: Socket) {
        onJsonLines(socket, (value) => {
            const response = value as RpcResponse;
            const entry = this.pending.get(response.id);
            if (entry) {
                this.pending.delete(response.id);
                entry.resolve(response);
            }
        });
        const fail = (error: Error) => {
            for (const entry of this.pending.values()) entry.reject(error);
            this.pending.clear();
        };
        socket.on('error', fail);
        socket.on('close', () => fail(new Error('The connection to the Nova AI Browser host closed.')));
    }

    public static connect(path: string, timeoutMs = 2_000): Promise<RpcClient> {
        return new Promise((resolve, reject) => {
            const socket = createConnection(path);
            const timer = setTimeout(() => {
                socket.destroy();
                reject(new Error('Timed out connecting to the Nova AI Browser host.'));
            }, timeoutMs);
            socket.once('connect', () => {
                clearTimeout(timer);
                resolve(new RpcClient(socket));
            });
            socket.once('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });
        });
    }

    public request(request: Omit<RpcRequest, 'id'>, timeoutMs: number): Promise<RpcResponse> {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('The browser did not answer in time.'));
            }, timeoutMs);
            this.pending.set(id, {
                resolve: (value) => {
                    clearTimeout(timer);
                    resolve(value);
                },
                reject: (error) => {
                    clearTimeout(timer);
                    reject(error);
                }
            });
            this.socket.write(`${JSON.stringify({ ...request, id })}\n`);
        });
    }

    public close(): void {
        this.socket.end();
    }
}
