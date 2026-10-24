<script lang="ts">
    import { onDestroy } from 'svelte';
    import { saveSettings, type Settings } from '../../lib/settings';
    import type { HostStatus } from '../../background/native';
    import { agentApprovals, forgetAgent, SESSION_ALLOWED, SESSION_DENIED, sessionList, storeAgentApproval, type AgentApproval } from '../../lib/agentApprovals';

    interface AgentRow {
        id: string;
        name: string;
        state: 'always' | 'session' | 'blocked' | 'denied';
    }

    let { settings }: { settings: Settings } = $props();

    let status = $state<HostStatus>({ state: 'disconnected' });
    let copied = $state<string | undefined>();

    const INSTALL = 'npx @datalabrotterdam/nova-ai-browser-host install';
    const MCP = 'npx -y -p @datalabrotterdam/nova-ai-browser-host nova-ai-browser-mcp';
    const snippets = [
        { id: 'skill', label: 'nova-browser skill for Claude Code and Codex (Nova gets it with the install)', text: `${INSTALL} --skills nova,claude,codex` },
        { id: 'claude', label: 'Claude Code', text: `claude mcp add nova-browser -- ${MCP}` },
        {
            id: 'vscode',
            label: 'VS Code (.vscode/mcp.json)',
            text: JSON.stringify({ servers: { 'nova-browser': { type: 'stdio', command: 'npx', args: ['-y', '-p', '@datalabrotterdam/nova-ai-browser-host', 'nova-ai-browser-mcp'] } } }, null, 2)
        }
    ];

    const LABELS: Record<HostStatus['state'], { icon: string; text: string }> = {
        connected: { icon: 'pass', text: 'Connected' },
        connecting: { icon: 'loading codicon-modifier-spin', text: 'Connecting…' },
        'not-installed': { icon: 'warning', text: 'Host not installed' },
        disconnected: { icon: 'debug-disconnect', text: 'Not connected' },
        disabled: { icon: 'circle-slash', text: 'Off' }
    };

    let agents = $state<AgentRow[]>([]);

    async function refresh() {
        status = ((await chrome.storage.session.get('hostStatus')).hostStatus as HostStatus | undefined) ?? { state: 'disconnected' };
        const stored = await agentApprovals();
        const names = (((await chrome.storage.session.get('agentNames')).agentNames ?? {}) as Record<string, string>);
        const rows = new Map<string, AgentRow>();
        for (const [id, approval] of Object.entries(stored) as Array<[string, AgentApproval]>) {
            rows.set(id, { id, name: approval.name, state: approval.decision === 'always' ? 'always' : 'blocked' });
        }
        for (const id of await sessionList(SESSION_ALLOWED)) if (!rows.has(id)) rows.set(id, { id, name: names[id] ?? id, state: 'session' });
        for (const id of await sessionList(SESSION_DENIED)) if (!rows.has(id)) rows.set(id, { id, name: names[id] ?? id, state: 'denied' });
        agents = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    const listener = (_changes: Record<string, chrome.storage.StorageChange>) => void refresh();
    chrome.storage.onChanged.addListener(listener);
    onDestroy(() => chrome.storage.onChanged.removeListener(listener));
    void refresh();

    async function copy(id: string, text: string) {
        await navigator.clipboard.writeText(text);
        copied = id;
        setTimeout(() => (copied = undefined), 1200);
    }

    async function block(agent: AgentRow) {
        await storeAgentApproval(agent.id, { name: agent.name, decision: 'deny', decidedAt: new Date().toISOString() });
    }

    const STATES: Record<AgentRow['state'], { icon: string; text: string }> = {
        always: { icon: 'pass', text: 'Always allowed' },
        session: { icon: 'pass', text: 'Allowed until the browser closes' },
        blocked: { icon: 'circle-slash', text: 'Blocked' },
        denied: { icon: 'circle-slash', text: 'Denied until the browser closes' }
    };

    async function reconnect() {
        await chrome.runtime.sendMessage({ type: 'host/connect' });
    }

    const label = $derived(LABELS[status.state]);
</script>

<section>
    <h2>External agents</h2>
    <label class="check">
        <input type="checkbox" checked={settings.externalAgents} onchange={(e) => saveSettings({ externalAgents: e.currentTarget.checked })} />
        <span>Let VS Code, Claude Code and ACP agents use this browser</span>
    </label>

    {#if settings.externalAgents}
        <div class={`status ${status.state}`}>
            <span class={`codicon codicon-${label.icon}`} aria-hidden="true"></span>
            <span class="grow">{label.text}{status.version ? ` · host ${status.version}` : ''}</span>
            <button class="nova-icon-button codicon codicon-refresh" title="Reconnect" aria-label="Reconnect to the host" onclick={reconnect}></button>
        </div>
        {#if status.error && status.state !== 'connected'}
            <p class="hint error-detail">Browser says: <code>{status.error}</code></p>
        {/if}

        <div class="snippet-label">Connected agents</div>
        {#if agents.length}
            <ul class="agents">
                {#each agents as agent (agent.id)}
                    <li class={agent.state}>
                        <span class={`codicon codicon-${STATES[agent.state].icon}`} aria-hidden="true"></span>
                        <span class="agent-name">{agent.name}</span>
                        <span class="agent-state">{STATES[agent.state].text}</span>
                        {#if agent.state === 'always' || agent.state === 'session'}
                            <button class="nova-icon-button codicon codicon-circle-slash" title="Block" aria-label={`Block ${agent.name}`} onclick={() => block(agent)}></button>
                        {/if}
                        <button class="nova-icon-button codicon codicon-close" title="Forget: ask again next time" aria-label={`Forget ${agent.name}`} onclick={() => forgetAgent(agent.id)}></button>
                    </li>
                {/each}
            </ul>
        {:else}
            <p class="hint">None yet. The first time an agent wants to use the browser, Nova asks you.</p>
        {/if}

        {#if status.state === 'not-installed'}
            <p class="hint">Install the host and the <code>nova-browser</code> skill once (needs Node.js 20+), then press reconnect. Nova AI in VS Code and the CLI then use your browser through the skill.</p>
            <div class="snippet">
                <code>{INSTALL}</code>
                <button class="nova-icon-button codicon codicon-{copied === 'install' ? 'check' : 'copy'}" title="Copy" aria-label="Copy install command" onclick={() => copy('install', INSTALL)}></button>
            </div>
        {:else}
            <p class="hint">Nova AI uses this browser through the <code>nova-browser</code> skill. Other agents can use the skill or connect over MCP:</p>
            {#each snippets as snippet (snippet.id)}
                <div class="snippet-label">{snippet.label}</div>
                <div class="snippet">
                    <code>{snippet.text}</code>
                    <button class="nova-icon-button codicon codicon-{copied === snippet.id ? 'check' : 'copy'}" title="Copy" aria-label={`Copy ${snippet.label} config`} onclick={() => copy(snippet.id, snippet.text)}></button>
                </div>
            {/each}
        {/if}
    {/if}
</section>

<style lang="scss">
  section {
    display: grid;
    gap: 6px;
    padding: 12px 0;
    border-bottom: 1px solid var(--nova-border);
  }

  h2 {
    margin: 0 0 2px;
    color: var(--nova-muted);
    font-size: 0.85em;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .check {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 8px;

    input {
      margin: 0;
      accent-color: var(--nova-button-bg);
    }
  }

  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--nova-muted);

    &.connected .codicon:first-child {
      color: var(--nova-success);
    }

    &.not-installed .codicon:first-child {
      color: var(--nova-warning);
    }
  }

  .grow {
    flex: 1;
    color: var(--nova-fg);
  }

  .hint,
  .snippet-label {
    color: var(--nova-muted);
  }

  .snippet-label {
    margin-top: 4px;
    font-size: 0.92em;
  }

  .agents {
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
    }

    .always .codicon:first-child,
    .session .codicon:first-child {
      color: var(--nova-success);
    }

    .blocked .codicon:first-child,
    .denied .codicon:first-child {
      color: var(--nova-error);
    }
  }

  .agent-name {
    font-weight: 600;
  }

  .agent-state {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--nova-muted);
    font-size: 0.92em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .snippet {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 4px;
    padding: 4px 4px 4px 8px;
    border: 1px solid var(--nova-subtle-border);
    border-radius: var(--nova-radius);
    background: var(--nova-code-bg);

    code {
      flex: 1;
      min-width: 0;
      font-size: 0.9em;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  }
</style>
