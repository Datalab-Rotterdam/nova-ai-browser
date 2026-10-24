<script lang="ts">
    import { TOOL_DEFINITIONS, type ToolResult } from '@datalabrotterdam/nova-ai-browser-protocol';
    import { callTool } from '../../lib/bridge';
    import ToolCard from './ToolCard.svelte';

    const EXAMPLES: Record<string, Record<string, unknown>> = {
        tabs_context: {},
        tabs_create: { url: 'https://example.com' },
        navigate: { tabId: 0, url: 'https://example.com' },
        computer: { tabId: 0, action: 'screenshot' },
        read_page: { tabId: 0, filter: 'interactive' },
        find: { tabId: 0, query: 'search box' },
        form_input: { tabId: 0, ref: 'ref_1', value: 'hello' },
        get_page_text: { tabId: 0 }
    };

    let name = $state('tabs_context');
    let argsText = $state('{}');
    let error = $state<string | undefined>();
    let busy = $state(false);
    let runs = $state<Array<{ id: number; name: string; args: Record<string, unknown>; result?: ToolResult }>>([]);
    let counter = 0;

    const description = $derived(TOOL_DEFINITIONS.find((tool) => tool.name === name)?.description ?? '');

    async function activeGroupTab(): Promise<number | undefined> {
        const groupId = (await chrome.storage.session.get('novaGroupId')).novaGroupId as number | undefined;
        if (groupId === undefined) return undefined;
        const [tab] = await chrome.tabs.query({ groupId, active: true });
        return tab?.id ?? (await chrome.tabs.query({ groupId }))[0]?.id;
    }

    async function pick(tool: string) {
        name = tool;
        const example = { ...(EXAMPLES[tool] ?? { tabId: 0 }) };
        if ('tabId' in example) example.tabId = (await activeGroupTab()) ?? 0;
        argsText = JSON.stringify(example, null, 2);
        error = undefined;
    }

    async function run(event: SubmitEvent) {
        event.preventDefault();
        let args: Record<string, unknown>;
        try {
            args = JSON.parse(argsText || '{}');
        } catch (e) {
            error = `Arguments are not valid JSON: ${(e as Error).message}`;
            return;
        }
        error = undefined;
        busy = true;
        const id = ++counter;
        runs = [{ id, name, args }, ...runs].slice(0, 20);
        const result = await callTool(name, args, 'debug');
        runs = runs.map((entry) => entry.id === id ? { ...entry, result } : entry);
        busy = false;
    }
</script>

<form class="tester" onsubmit={run}>
    <p class="hint"><span class="codicon codicon-beaker" aria-hidden="true"></span>Run browser tools by hand, without a model. Site prompts are skipped here.</p>

    <label for="tool">Tool</label>
    <select id="tool" class="nova-input" value={name} onchange={(e) => pick(e.currentTarget.value)}>
        {#each TOOL_DEFINITIONS as tool (tool.name)}
            <option value={tool.name}>{tool.name}</option>
        {/each}
    </select>
    <p class="description">{description.split('\n')[0]}</p>

    <label for="args">Arguments (JSON)</label>
    <textarea id="args" class="nova-input" rows="6" bind:value={argsText} spellcheck="false"></textarea>
    {#if error}
        <p class="error"><span class="codicon codicon-error" aria-hidden="true"></span>{error}</p>
    {/if}
    <button class="nova-button" type="submit" disabled={busy}>
        {#if busy}<span class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true"></span>Running…{:else}<span class="codicon codicon-play" aria-hidden="true"></span>Run tool{/if}
    </button>

    {#if runs.length}
        <div class="runs" aria-label="Results">
            {#each runs as entry (entry.id)}
                <ToolCard name={entry.name} args={entry.args} result={entry.result} />
            {/each}
        </div>
    {/if}
</form>

<style lang="scss">
  .tester {
    display: grid;
    gap: 6px;
    padding: 12px;
  }

  label {
    margin-top: 4px;
  }

  .hint,
  .description {
    color: var(--nova-muted);
  }

  .hint {
    display: flex;
    gap: 6px;
  }

  .description {
    font-size: 0.92em;
  }

  textarea {
    resize: vertical;
    font-family: var(--nova-mono);
    font-size: 12px;
  }

  .error {
    display: flex;
    gap: 6px;
    padding: 6px 8px;
    border: 1px solid var(--nova-error-border);
    border-radius: 2px;
    background: var(--nova-error-bg);
    overflow-wrap: anywhere;

    .codicon {
      color: var(--nova-error);
    }
  }

  .runs {
    display: grid;
    gap: 8px;
    margin-top: 10px;
  }
</style>
