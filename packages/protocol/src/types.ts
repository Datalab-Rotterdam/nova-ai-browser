/** Content of a tool result. Same shape as MCP content blocks, so results pass through MCP and ACP unchanged. */
export type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string };

export interface ToolResult {
    content: ContentBlock[];
    isError?: boolean;
    /**
     * Shown to the user instead of the content's image and never sent to a model or an external
     * agent, e.g. a full-page screenshot at full resolution. `note` says what the model got instead.
     */
    userImage?: { type: 'image'; data: string; mimeType: string; note: string };
}

export type JsonSchema = Record<string, unknown>;

export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: JsonSchema;
    /** True when the tool never changes page or browser state. Exposed to MCP as `readOnlyHint`. */
    readOnly: boolean;
}

/** Who asked for a tool call; used for permission prompts and the activity log. */
export type ToolCaller = 'sidepanel' | 'mcp' | 'acp' | 'debug';

/** An external agent (MCP/ACP client or the skill script), as it identified itself. */
export interface AgentClient {
    /** Stable key for approvals, e.g. "vscode". */
    id: string;
    /** What the user sees, e.g. "Visual Studio Code". */
    name: string;
    /** The agent says its user already approved this call (Nova's own permissions): no site prompt. */
    preApproved?: boolean;
}

export interface ToolCallRequest {
    name: string;
    args: Record<string, unknown>;
    caller: ToolCaller;
    /** Set for mcp/acp callers. */
    client?: AgentClient;
}

const KNOWN_CLIENTS: Array<[RegExp, string, string]> = [
    [/visual studio code|^vscode|code helper|^code$|code - insiders|nova-ai-vscode/i, 'vscode', 'Visual Studio Code'],
    [/cursor/i, 'cursor', 'Cursor'],
    [/windsurf/i, 'windsurf', 'Windsurf'],
    [/claude/i, 'claude-code', 'Claude Code'],
    [/codex/i, 'codex', 'Codex'],
    [/nova-ai-cli|^nova$/i, 'nova-ai-cli', 'Nova AI CLI'],
    [/zed/i, 'zed', 'Zed'],
    [/jetbrains|intellij|webstorm|pycharm|\bidea\b/i, 'jetbrains', 'JetBrains IDE']
];

/** Maps a reported client or process name to a stable id and a friendly name. */
export function identifyClient(raw: string | undefined): AgentClient {
    const name = (raw ?? '').trim();
    for (const [pattern, id, display] of KNOWN_CLIENTS) {
        if (pattern.test(name)) return { id, name: display };
    }
    if (!name) return { id: 'unknown', name: 'An unknown agent' };
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'unknown';
    return { id, name: name.slice(0, 60) };
}

export function textResult(text: string): ToolResult {
    return { content: [{ type: 'text', text }] };
}

export function errorResult(text: string): ToolResult {
    return { content: [{ type: 'text', text }], isError: true };
}

/** Joins the text blocks of a result; images become a short placeholder. */
export function resultText(result: ToolResult): string {
    return result.content
        .map((block) => block.type === 'text' ? block.text : `[image ${block.mimeType}]`)
        .join('\n');
}
