<script lang="ts">
    // Ported from nova-ai-vscode webview/src/chat/ModelMenu.svelte; keep the two in sync.
    import type { ModelResponse } from '@datalabrotterdam/nova-sdk';
    import { effortFor, hasThinkingSwitch, modelEfforts } from '@datalabrotterdam/nova-ai-browser-protocol';

    interface Props {
        models: ModelResponse[];
        modelId: string;
        /** The chosen effort; the menu shows what is actually sent (`effortFor`). */
        effort: string;
        onmodel: (modelId: string) => void;
        oneffort: (effort: string) => void;
    }

    let { models, modelId, effort, onmodel, oneffort }: Props = $props();

    const PLATFORM = 'https://platform.nova.datalabrotterdam.nl';

    let open = $state(false);
    let query = $state('');
    let wrap: HTMLElement | undefined = $state();

    const current = $derived(models.find((m) => m.id === modelId));
    const shown = $derived.by(() => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        return models.filter((m) => {
            const hay = `${m.id} ${m.name ?? ''} ${description(m)}`.toLowerCase();
            return words.every((word) => hay.includes(word));
        });
    });
    const efforts = $derived(modelEfforts(current));
    const thinkingSwitch = $derived(hasThinkingSwitch(current));
    const level = $derived(effortFor(current, effort));
    const effortIndex = $derived(Math.max(0, efforts.indexOf(level ?? '')));
    const label = (value: string) => (value === 'none' ? 'Off' : value === 'xhigh' ? 'Extra high' : value[0].toUpperCase() + value.slice(1));

    /** Model descriptions may hold markup; the menu shows plain text. */
    function description(model: ModelResponse): string {
        return (model.description ?? '').replace(/<\/?[a-z][a-z0-9]*\b[^>]*>/gi, ' ').replace(/\s+/g, ' ').trim();
    }

    /** Keep the menu inside the panel: up to 320px wide, shifted left when it would pass the right edge. */
    function fit(node: HTMLElement) {
        const margin = 8;
        const anchor = node.parentElement!.getBoundingClientRect();
        const width = Math.min(320, window.innerWidth - margin * 2);
        node.style.width = `${width}px`;
        node.style.left = `${Math.max(margin - anchor.left, Math.min(0, window.innerWidth - margin - width - anchor.left))}px`;
    }

    /** Focus the search box as the menu opens. */
    const focus = (node: HTMLInputElement) => node.focus();

    /** Arrow keys walk the search box and the model rows; Enter in the search box picks the first match. */
    function onKey(event: KeyboardEvent) {
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement && shown[0]) {
            event.preventDefault();
            onmodel(shown[0].id);
            return;
        }
        const move = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        if (!move || !wrap) return;
        event.preventDefault();
        const items = [...wrap.querySelectorAll<HTMLElement>('[data-nav]')];
        const index = items.indexOf(document.activeElement as HTMLElement);
        items[(index + move + items.length) % items.length]?.focus();
    }

    // Close on outside click or Escape.
    $effect(() => {
        if (!open) return;
        const onDown = (event: Event) => {
            if (wrap && !wrap.contains(event.target as Node)) open = false;
        };
        const onEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') open = false;
        };
        window.addEventListener('pointerdown', onDown);
        window.addEventListener('keydown', onEscape, true);
        return () => {
            window.removeEventListener('pointerdown', onDown);
            window.removeEventListener('keydown', onEscape, true);
        };
    });
</script>

<div class="drop" bind:this={wrap}>
    <button
            class="chip"
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Model"
            title="Model"
            disabled={!models.length}
            onclick={() => {
                open = !open;
                query = '';
            }}
    >
        <span class="label">
            {(current?.name ?? current?.id ?? (models.length ? 'Pick a model' : 'No models')) + (efforts.length > 1 && level && !thinkingSwitch ? ` (${label(level)})` : '')}
        </span>
        <span class="codicon codicon-chevron-up caret" aria-hidden="true"></span>
    </button>
    {#if open}
        <!-- svelte-ignore a11y_interactive_supports_focus -->
        <div class="pop" role="menu" aria-label="Model" onkeydown={onKey} use:fit>
            <input class="search" data-nav type="search" placeholder="Search models…" aria-label="Search models" bind:value={query} use:focus />
            <div class="list">
                {#each shown as model (model.id)}
                    <div class="item" class:current={model.id === modelId}>
                        <button
                                class="row"
                                data-nav
                                type="button"
                                role="menuitemradio"
                                aria-checked={model.id === modelId}
                                title={description(model) || undefined}
                                onclick={() => onmodel(model.id)}
                        >
                            <span class="text">
                                <span class="name">{model.name ?? model.id}</span>
                                {#if description(model)}<span class="desc">{description(model)}</span>{/if}
                            </span>
                            {#if model.id === modelId}<span class="codicon codicon-check tick" aria-hidden="true"></span>{/if}
                        </button>
                        <a
                                class="info codicon codicon-info"
                                href="{PLATFORM}/dashboard/models/{encodeURIComponent(model.id)}"
                                target="_blank"
                                rel="noreferrer"
                                title="View {model.name ?? model.id} on the Nova platform"
                                aria-label="View {model.name ?? model.id} on the Nova platform"
                        ></a>
                    </div>
                {/each}
                {#if !shown.length}<p class="empty">No models match.</p>{/if}
            </div>
            {#if efforts.length > 1}
                <div class="rule"></div>
                <div class="effort">
                    {#if thinkingSwitch}
                        <label class="switch">
                            <span>Thinking</span>
                            <input
                                    type="checkbox"
                                    role="switch"
                                    checked={level !== 'none'}
                                    onchange={(event) => oneffort(event.currentTarget.checked ? 'medium' : 'none')}
                            />
                        </label>
                    {:else}
                        <span>Effort <span class="level">({label(level ?? efforts[0])})</span></span>
                        <div class="slider" role="radiogroup" aria-label="Effort">
                            <span class="fill" style="width: calc(9px + {effortIndex} * (100% - 18px) / {efforts.length - 1} + 9px)"></span>
                            <span class="thumb" style="left: calc({effortIndex} * (100% - 18px) / {efforts.length - 1})"></span>
                            {#each efforts as value (value)}
                                <button
                                        class="stop"
                                        type="button"
                                        role="radio"
                                        aria-checked={value === level}
                                        aria-label={label(value)}
                                        title={label(value)}
                                        onclick={() => oneffort(value)}
                                ></button>
                            {/each}
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
</div>

<style lang="scss">
  .drop {
    position: relative;
    min-width: 0;
    max-width: 55%;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    padding: 1px 4px;
    border: 0;
    border-radius: var(--nova-radius);
    background: transparent;
    color: var(--nova-muted);
    font: inherit;
    font-size: 0.9em;
    cursor: pointer;

    &:hover:not(:disabled),
    &[aria-expanded="true"] {
      background: var(--nova-hover);
      color: var(--nova-fg);
    }

    &:disabled {
      cursor: default;
    }
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .caret {
    font-size: 0.8em;
    opacity: 0.7;
  }

  .pop {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    z-index: 40;
    padding: 6px;
    border: 1px solid var(--nova-border);
    border-radius: var(--nova-radius-large, 8px);
    background: var(--nova-surface, var(--nova-bg));
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.35);
  }

  .search {
    box-sizing: border-box;
    width: 100%;
    margin-bottom: 4px;
    padding: 4px 8px;
    border: 1px solid var(--nova-input-border, var(--nova-border));
    border-radius: var(--nova-radius);
    background: var(--nova-input-bg, transparent);
    color: var(--nova-input-fg, var(--nova-fg));
    font: inherit;
    font-size: 0.9em;

    &:focus {
      border-color: var(--nova-focus);
      outline: none;
    }
  }

  .empty {
    margin: 0;
    padding: 6px 8px;
    color: var(--nova-muted);
    font-size: 0.9em;
  }

  /* About five rows; the rest scrolls, and the effort slider stays in view. */
  .list {
    max-height: 200px;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .rule {
    height: 1px;
    margin: 6px 4px;
    background: var(--nova-subtle-border, var(--nova-border));
  }

  .item {
    display: flex;
    align-items: center;
    border-radius: var(--nova-radius);

    &:hover,
    &:focus-within,
    &.current {
      background: var(--nova-hover);
    }
  }

  .info {
    flex: none;
    align-self: flex-start;
    margin: 4px 4px 0 0;
    padding: 4px;
    border-radius: var(--nova-radius);
    color: var(--nova-muted);
    text-decoration: none;

    &:hover {
      color: var(--nova-link, var(--nova-fg));
    }
  }

  .row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--nova-radius);
    background: transparent;
    color: var(--nova-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;

    &:focus-visible {
      outline: none;
    }
  }

  .text {
    display: grid;
    flex: 1;
    min-width: 0;
  }

  .name {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .desc {
    overflow: hidden;
    color: var(--nova-muted);
    font-size: 0.85em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tick {
    margin-top: 2px;
    color: var(--nova-focus);
  }

  .effort {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 4px 8px;
    color: var(--nova-fg);
  }

  .switch {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: space-between;
    cursor: pointer;
  }

  /* A track with a sliding thumb; on is filled like the effort slider. */
  .switch input {
    appearance: none;
    position: relative;
    flex: none;
    width: 34px;
    height: 20px;
    margin: 0;
    border-radius: 999px;
    background: var(--nova-hover);
    cursor: pointer;
    transition: background 0.12s ease;

    &::after {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--nova-muted);
      transition: transform 0.12s ease, background 0.12s ease;
    }

    &:checked {
      background: var(--nova-button-bg, var(--nova-focus));
    }

    &:checked::after {
      background: #fff;
      transform: translateX(14px);
    }

    &:focus-visible {
      outline: 1px solid var(--nova-focus);
      outline-offset: 2px;
    }
  }

  .level {
    color: var(--nova-muted);
  }

  /* A pill with one stop per level and a thumb on the chosen one. */
  .slider {
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 120px;
    height: 22px;
    padding: 0 2px;
    border-radius: 999px;
    background: var(--nova-hover);
  }

  .stop {
    position: relative;
    z-index: 1;
    width: 18px;
    height: 22px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;

    &::after {
      content: "";
      position: absolute;
      top: 50%;
      left: 50%;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: var(--nova-muted);
      opacity: 0.6;
      transform: translate(-50%, -50%);
    }
  }

  /* Progress: everything up to and including the chosen level. */
  .fill {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    max-width: 100%;
    border-radius: 999px;
    background: color-mix(in srgb, var(--nova-button-bg, var(--nova-focus)) 55%, transparent);
    transition: width 0.12s ease;
    pointer-events: none;
  }

  .thumb {
    z-index: 2;
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--nova-button-bg, var(--nova-focus));
    transition: left 0.12s ease;
    pointer-events: none;
  }
</style>
