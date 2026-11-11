<script lang="ts">
    // Ported from the permissions dropdown in nova-ai-vscode webview/src/chat/ModeMenu.svelte; keep the two in sync.
    import { PERMISSION_OPTIONS, permissionOption, type ApprovalMode } from '../../lib/settings';

    interface Props {
        mode: ApprovalMode;
        onmode: (mode: ApprovalMode) => void;
    }

    let { mode, onmode }: Props = $props();

    let open = $state(false);
    let wrap: HTMLElement | undefined = $state();

    const current = $derived(permissionOption(mode));

    /** Keep the menu inside the panel: up to 320px wide, shifted left when it would pass the right edge. */
    function fit(node: HTMLElement) {
        const margin = 8;
        const anchor = node.parentElement!.getBoundingClientRect();
        const width = Math.min(320, window.innerWidth - margin * 2);
        node.style.width = `${width}px`;
        node.style.left = `${Math.max(margin - anchor.left, Math.min(0, window.innerWidth - margin - width - anchor.left))}px`;
    }

    /** Focus the chosen row as the menu opens. */
    function focusCurrent(node: HTMLElement) {
        node.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    }

    function pick(next: ApprovalMode) {
        onmode(next);
        open = false;
    }

    function onKey(event: KeyboardEvent) {
        const move = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        if (!move || !wrap) return;
        event.preventDefault();
        const items = [...wrap.querySelectorAll<HTMLElement>('[data-menu-item]')];
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
            class:warn={mode === 'autoAll'}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`Permissions: ${current.label}`}
            title="When Nova asks before using a site"
            onclick={() => (open = !open)}
    >
        <span class={`codicon codicon-${current.icon}`} aria-hidden="true"></span>
        <span class="label">{current.label}</span>
        <span class="codicon codicon-chevron-up caret" aria-hidden="true"></span>
    </button>
    {#if open}
        <!-- svelte-ignore a11y_interactive_supports_focus -->
        <div class="pop" role="menu" aria-label="Permissions" onkeydown={onKey} use:fit use:focusCurrent>
            {#each PERMISSION_OPTIONS as option (option.mode)}
                <button
                        class="row"
                        class:current={option.mode === mode}
                        class:danger={option.mode === 'autoAll'}
                        type="button"
                        role="menuitemradio"
                        aria-checked={option.mode === mode}
                        data-menu-item
                        onclick={() => pick(option.mode)}
                >
                    <span class={`codicon codicon-${option.icon} lead`} aria-hidden="true"></span>
                    <span class="text">
                        <span class="name">{option.label}</span>
                        <span class="desc">{option.description}</span>
                    </span>
                    {#if option.mode === mode}<span class="codicon codicon-check tick" aria-hidden="true"></span>{/if}
                </button>
            {/each}
        </div>
    {/if}
</div>

<style lang="scss">
  .drop {
    position: relative;
    min-width: 0;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    padding: 2px 6px;
    border: 0;
    border-radius: var(--nova-radius);
    background: transparent;
    color: var(--nova-muted);
    font: inherit;
    font-size: 0.9em;
    cursor: pointer;

    .codicon {
      font-size: 14px;
    }

    &:hover,
    &[aria-expanded="true"] {
      background: var(--nova-hover);
      color: var(--nova-fg);
    }

    &.warn {
      color: var(--nova-warning);
    }
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .caret {
    opacity: 0.7;

    .chip & {
      font-size: 0.8em;
    }
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

  .row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--nova-radius);
    background: transparent;
    color: var(--nova-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;

    &:hover,
    &:focus-visible,
    &.current {
      background: var(--nova-hover);
      outline: none;
    }

    &.danger .lead {
      color: var(--nova-warning);
    }
  }

  .lead {
    margin-top: 2px;
    color: var(--nova-muted);
  }

  .text {
    display: grid;
    flex: 1;
    min-width: 0;
    gap: 1px;
  }

  .name {
    font-weight: 600;
  }

  .desc {
    color: var(--nova-muted);
    font-size: 0.9em;
    overflow-wrap: anywhere;
  }

  .tick {
    margin-top: 2px;
    color: var(--nova-focus);
  }

  @media (forced-colors: active) {
    .row:focus-visible {
      outline: 1px solid Highlight;
    }
  }

  /* Too narrow for the label: the icon (warning color for "Allow all") still shows the mode. */
  @media (max-width: 200px) {
    .label {
      display: none;
    }
  }
</style>
