<script lang="ts">
    // Same look as nova-ai-vscode's webview/src/chat/ToolCard.svelte.
    import { resultText, type ToolResult } from '@datalabrotterdam/nova-ai-browser-protocol';

    interface Props {
        name: string;
        args: Record<string, unknown>;
        result?: ToolResult;
    }

    let { name, args, result }: Props = $props();
    let expanded = $state(false);

    const TITLES: Record<string, string> = {
        tabs_context: 'List tabs',
        tabs_create: 'Open tab',
        tabs_close: 'Close tab',
        navigate: 'Navigate',
        read_page: 'Read page',
        find: 'Find',
        form_input: 'Fill in',
        get_page_text: 'Read text',
        javascript_tool: 'Run JavaScript',
        read_console_messages: 'Read console',
        read_network_requests: 'Read network',
        resize_window: 'Resize window'
    };

    const ACTIONS: Record<string, string> = {
        screenshot: 'Screenshot', left_click: 'Click', right_click: 'Right-click', middle_click: 'Middle-click',
        double_click: 'Double-click', triple_click: 'Triple-click', hover: 'Hover', left_click_drag: 'Drag',
        type: 'Type', key: 'Press', scroll: 'Scroll', scroll_to: 'Scroll to', zoom: 'Zoom', wait: 'Wait'
    };

    const ICONS: Record<string, string> = {
        tabs_context: 'browser', tabs_create: 'add', tabs_close: 'close', navigate: 'globe', read_page: 'list-tree',
        find: 'search', form_input: 'edit', get_page_text: 'file-text', javascript_tool: 'terminal',
        read_console_messages: 'output', read_network_requests: 'radio-tower', resize_window: 'screen-full'
    };

    const title = $derived(name === 'computer' ? (ACTIONS[String(args.action)] ?? String(args.action ?? 'Computer')) : (TITLES[name] ?? name));
    const detail = $derived.by(() => {
        if (name === 'computer') {
            if (args.text) return String(args.text);
            if (args.ref) return String(args.ref);
            if (Array.isArray(args.coordinate)) return args.coordinate.map((n) => Math.round(Number(n))).join(', ');
            if (args.scroll_direction) return String(args.scroll_direction);
            return '';
        }
        if (name === 'navigate' || name === 'tabs_create') return String(args.url ?? '');
        if (name === 'find') return String(args.query ?? '');
        if (name === 'form_input') return `${String(args.ref ?? '')} = ${String(args.value ?? '')}`;
        return '';
    });
    const status = $derived(!result ? 'running' : result.isError ? 'error' : 'done');
    const icon = $derived(status === 'running' ? 'loading codicon-modifier-spin' : status === 'error' ? 'error' : 'check');
    const kindIcon = $derived(name === 'computer' ? (args.action === 'screenshot' || args.action === 'zoom' ? 'device-camera' : args.action === 'type' || args.action === 'key' ? 'keyboard' : 'target') : (ICONS[name] ?? 'tools'));
    const image = $derived(result?.content.find((block) => block.type === 'image'));
    const output = $derived(result ? resultText(result).replace(/\[image [^\]]+\]/g, '').trim() : '');
    const input = $derived(JSON.stringify(Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'tabId')), null, 2));
</script>

<div class={`tool ${status}`}>
    <button class="summary" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
        <span class={`codicon codicon-${icon} status-icon`} aria-hidden="true"></span>
        <span class={`codicon codicon-${kindIcon} kind-icon`} aria-hidden="true"></span>
        <span class="title">{title}</span>
        {#if detail}<span class="detail">{detail}</span>{/if}
        <span class={`codicon codicon-chevron-${expanded ? 'up' : 'down'} chevron`} aria-hidden="true"></span>
    </button>

    {#if image && image.type === 'image'}
        <img class="shot" src={`data:${image.mimeType};base64,${image.data}`} alt="Screenshot Nova took of the page" />
    {/if}

    {#if status === 'error' && !expanded}
        <p class="error-text">{output.slice(0, 300)}</p>
    {/if}

    {#if expanded}
        <div class="body">
            <div class="label">Input</div>
            <pre>{input}</pre>
            {#if output}
                <div class="label">Output</div>
                <pre>{output.length > 8000 ? `${output.slice(0, 8000)}\n…` : output}</pre>
            {/if}
        </div>
    {/if}
</div>

<style lang="scss">
  .tool {
    border: 1px solid var(--nova-subtle-border);
    border-radius: var(--nova-radius-large);
    background: var(--nova-surface);
  }

  .summary {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 0;
    background: none;
    color: var(--nova-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;

    &:hover .chevron,
    &:focus-visible .chevron {
      visibility: visible;
    }
  }

  .status-icon,
  .kind-icon,
  .chevron {
    flex: none;
  }

  .title,
  .detail {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    flex: 0 1 auto;
  }

  .detail {
    flex: 0 1000 auto;
    color: var(--nova-muted);
    font-family: var(--nova-mono);
    font-size: 0.9em;
  }

  .chevron {
    margin-left: auto;
    visibility: hidden;
    color: var(--nova-muted);
  }

  .status-icon,
  .kind-icon {
    color: var(--nova-muted);
  }

  .done .status-icon {
    color: var(--nova-success);
  }

  .error .status-icon {
    color: var(--nova-error);
  }

  .shot {
    display: block;
    width: calc(100% - 16px);
    margin: 0 8px 8px;
    border: 1px solid var(--nova-subtle-border);
    border-radius: var(--nova-radius);
  }

  .error-text {
    padding: 0 8px 6px 28px;
    color: var(--nova-error);
    font-size: 0.92em;
    overflow-wrap: anywhere;
  }

  .body {
    display: grid;
    gap: 4px;
    padding: 0 8px 8px;
  }

  .label {
    color: var(--nova-muted);
    font-size: 0.85em;
    text-transform: uppercase;
  }

  pre {
    max-height: 240px;
    margin: 0;
    overflow: auto;
    padding: 6px;
    border-radius: var(--nova-radius);
    background: var(--nova-input-bg);
    font-family: var(--nova-mono);
    font-size: 0.9em;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
