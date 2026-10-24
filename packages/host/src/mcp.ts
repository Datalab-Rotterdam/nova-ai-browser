/**
 * `nova-ai-browser-mcp`: an MCP server over stdio for VS Code, Claude Code and other MCP
 * clients. It forwards tool calls to the native host the browser started, so it works
 * whenever the browser with the Nova AI extension is running.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { errorResult, type AgentClient, type ToolResult } from '@datalabrotterdam/nova-ai-browser-protocol';
import { createMcpServer } from './mcpServer';
import { pickHost } from './hosts';
import type { HostInfo } from './paths';
import { RpcClient } from './rpc';

const NOT_CONNECTED = [
    'The Nova AI browser extension is not connected.',
    'Ask the user to open Chrome (or Edge/Brave) with the Nova AI extension enabled.',
    'If it still fails, the native host may not be installed: `npx @datalabrotterdam/nova-ai-browser-host install`.'
].join(' ');

let cached: { rpc: RpcClient; info: HostInfo } | undefined;

async function connect(): Promise<{ rpc: RpcClient; info: HostInfo } | undefined> {
    const info = pickHost();
    if (!info) return undefined;
    // Reuse the connection while the same host is running; reconnect after a browser restart.
    if (cached && cached.info.pid === info.pid) return cached;
    cached?.rpc.close();
    cached = undefined;
    try {
        cached = { rpc: await RpcClient.connect(info.socket), info };
        return cached;
    } catch {
        return undefined;
    }
}

async function callTool(name: string, args: Record<string, unknown>, client: AgentClient): Promise<ToolResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
        const connection = await connect();
        if (!connection) return errorResult(NOT_CONNECTED);
        try {
            const response = await connection.rpc.request({ method: 'callTool', params: { name, args, token: connection.info.token, client } }, 210_000);
            if (response.error) return errorResult(response.error);
            return response.result as ToolResult;
        } catch (error) {
            cached = undefined;
            if (attempt === 1) return errorResult(`${NOT_CONNECTED} (${error instanceof Error ? error.message : String(error)})`);
        }
    }
    return errorResult(NOT_CONNECTED);
}

const server = createMcpServer(callTool);
await server.connect(new StdioServerTransport());
