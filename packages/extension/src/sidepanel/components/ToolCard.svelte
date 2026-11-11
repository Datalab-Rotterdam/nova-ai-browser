<script lang="ts">
    // Same look as nova-ai-vscode's webview/src/chat/ToolCard.svelte.
    import { resultText, type ToolResult } from '@datalabrotterdam/nova-ai-browser-protocol';
    import { openImage } from '../viewer.svelte';
    import { toolDetail, toolIcon, toolTitle } from './toolLabels';

    interface Props {
        name: string;
        args: Record<string, unknown>;
        result?: ToolResult;
    }

    let { name, args, result }: Props = $props();
    let expanded = $state(false);

    const title = $derived(toolTitle(name, args));
    const detail = $derived(toolDetail(name, args));
    const status = $derived(!result ? 'running' : result.isError ? 'error' : 'done');
    const icon = $derived(status === 'running' ? 'loading codicon-modifier-spin' : status === 'error' ? 'error' : 'check');
    const kindIcon = $derived(toolIcon(name, args));
    // A full-resolution userImage (e.g. a full-page screenshot) replaces the model's scaled copy.
    const image = $derived(result?.userImage?.type === 'image' ? result.userImage : result?.content.find((block) => block.type === 'image'));
    const userImage = $derived(result?.userImage?.type === 'image' ? result.userImage : undefined);
    const output = $derived(result ? resultText(result).replace(/\[image [^\]]+\]/g, '').trim() : '');
    const imageSrc = $derived(image?.type === 'image' ? `data:${image.mimeType};base64,${image.data}` : '');
    const imageName = $derived(userImage ? 'Full-page screenshot' : 'Screenshot');
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
        {#if userImage}
            <!-- A long page would make the card very tall: it scrolls in its own box, reachable by keyboard. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <div class="shot-scroll" tabindex="0" role="region" aria-label="Full-page screenshot, scrollable">
                <button class="shot-button" type="button" title="Open to zoom in" onclick={() => openImage(imageSrc, imageName)}>
                    <img class="shot" src={imageSrc} alt="Full-page screenshot Nova took of the page" />
                </button>
            </div>
            <p class="image-note">
                <span class="codicon codicon-info" aria-hidden="true"></span>
                <span>{userImage.note}</span>
                <a href={imageSrc} download="nova-full-page.jpg">Save</a>
            </p>
        {:else}
            <button class="shot-button" type="button" title="Open to zoom in" onclick={() => openImage(imageSrc, imageName)}>
                <img class="shot" src={imageSrc} alt="Screenshot Nova took of the page" />
            </button>
        {/if}
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

  .shot-button {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;

    &:focus-visible {
      outline: 1px solid var(--nova-focus);
      outline-offset: -1px;
    }
  }

  .shot-scroll {
    max-height: 420px;
    margin: 0 8px 8px;
    overflow-y: auto;
    border: 1px solid var(--nova-subtle-border);
    border-radius: var(--nova-radius);

    .shot {
      width: 100%;
      margin: 0;
      border: 0;
      border-radius: 0;
    }
  }

  .image-note {
    display: flex;
    gap: 6px;
    align-items: baseline;
    margin: -4px 8px 8px;
    color: var(--nova-muted);
    font-size: 0.85em;

    .codicon {
      flex: none;
      font-size: 1em;
    }

    a {
      margin-left: auto;
      color: var(--nova-link);
    }
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
