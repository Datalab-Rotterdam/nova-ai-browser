<script lang="ts">
    // Same composer as nova-ai-vscode (webview/src/chat/Composer.svelte), with browser actions in the toolbar.
    import type { ModelResponse } from '@datalabrotterdam/nova-sdk';
    import type { QueuedMessage } from '../chat.svelte';
    import ModelMenu from './ModelMenu.svelte';

    interface Props {
        running: boolean;
        disabled: boolean;
        models: ModelResponse[];
        modelId: string;
        effort: string;
        vision: boolean;
        value?: string;
        queue: QueuedMessage[];
        onsend: (text: string) => void;
        onqueuemode: (id: number, mode: QueuedMessage['mode']) => void;
        onqueueremove: (id: number) => void;
        onqueuesendnow: (id: number) => void;
        onstop: () => void;
        onmodel: (modelId: string) => void;
        oneffort: (effort: string) => void;
        onusetab: () => void;
    }

    let { running, disabled, models, modelId, effort, vision, value = $bindable(''), queue, onsend, onqueuemode, onqueueremove, onqueuesendnow, onstop, onmodel, oneffort, onusetab }: Props = $props();
    let textarea: HTMLTextAreaElement | undefined = $state();

    // While Nova works, sending queues the message as steering (nothing is interrupted).
    const canSend = $derived(Boolean(value.trim()) && !disabled);

    function send() {
        if (!canSend) return;
        onsend(value);
        value = '';
        resize();
    }

    function onKeydown(event: KeyboardEvent) {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            send();
        }
    }

    function resize() {
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
    }

    $effect(() => {
        void value;
        resize();
    });

    $effect(() => {
        textarea?.focus();
    });
</script>

<div class="composer-wrap" class:running>
    {#if queue.length}
        <ul class="queue" aria-label="Waiting messages">
            {#each queue as item (item.id)}
                <li>
                    <button
                            class="mode"
                            class:steer={item.mode === 'steer'}
                            type="button"
                            title={item.mode === 'steer' ? 'Steer: given to Nova at its next step. Click to send after the reply instead.' : 'Queued: sent after the current reply. Click to steer Nova now instead.'}
                            onclick={() => onqueuemode(item.id, item.mode === 'steer' ? 'queue' : 'steer')}
                    >
                        <span class={`codicon codicon-${item.mode === 'steer' ? 'arrow-small-right' : 'clock'}`} aria-hidden="true"></span>{item.mode === 'steer' ? 'Steer' : 'Queued'}
                    </button>
                    <span class="queue-text" title={item.text}>{item.text}</span>
                    {#if !running || item.mode === 'queue'}
                        <button class="icon codicon codicon-play" type="button" title={running ? 'Steer now' : 'Send now'} aria-label="Send now" onclick={() => onqueuesendnow(item.id)}></button>
                    {/if}
                    <button class="icon codicon codicon-close" type="button" title="Remove" aria-label="Remove from queue" onclick={() => onqueueremove(item.id)}></button>
                </li>
            {/each}
        </ul>
    {/if}
    <form class="composer" onsubmit={(event) => { event.preventDefault(); send(); }}>
        <textarea
                bind:this={textarea}
                bind:value
                oninput={resize}
                onkeydown={onKeydown}
                rows="1"
                disabled={disabled}
                placeholder={disabled ? 'Connect Nova AI to start' : running ? 'Steer Nova or queue a follow-up…' : 'Ask Nova to do something in your browser…'}
                aria-label="Message Nova"
        ></textarea>

        <div class="toolbar">
            <button class="icon codicon codicon-browser" type="button" title="Let Nova use the current tab" aria-label="Let Nova use the current tab" onclick={onusetab}></button>

            <ModelMenu {models} {modelId} {effort} {onmodel} {oneffort} />

            <span class="mode" title={vision ? 'Nova sees screenshots of the page' : 'Nova reads the page as text (model without vision)'}>
                <span class={`codicon codicon-${vision ? 'eye' : 'list-flat'}`} aria-hidden="true"></span>
                <span class="mode-label">{vision ? 'Vision' : 'Text'}</span>
            </span>

            <span class="spacer"></span>

            {#if running}
                <button class="send stop" type="button" title="Stop" aria-label="Stop" onclick={onstop}>
                    <span class="stop-square" aria-hidden="true"></span>
                </button>
                {#if canSend}
                    <button class="send" type="submit" title="Steer Nova (Enter)" aria-label="Steer Nova">
                        <span class="codicon codicon-send" aria-hidden="true"></span>
                    </button>
                {/if}
            {:else}
                <button class="send" type="submit" title="Send (Enter)" aria-label="Send" disabled={!canSend}>
                    <span class="codicon codicon-send" aria-hidden="true"></span>
                </button>
            {/if}
        </div>
    </form>
</div>

<style lang="scss">
  /*
   * Same effect as the Nova platform chat bar: while Nova works, a soft primary-colored
   * radial glow (::before) and a slowly orbiting conic gradient (::after) fade in behind
   * the composer. Isolation keeps both above the panel background but below the composer.
   */
  .composer-wrap {
    --nova-glow-angle: 0deg;
    position: relative;
    isolation: isolate;
    flex: none;
    margin: 4px 10px 12px;
    animation: nova-chatbar-enter 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;

    &::before,
    &::after {
      content: '';
      position: absolute;
      top: 55%;
      left: 50%;
      width: calc(100% + 0.5rem);
      height: calc(100% + 1.75rem);
      border-radius: 999px;
      opacity: 0;
      pointer-events: none;
      transform: translate(-50%, -50%) scale(0.9);
      transition: opacity 0.42s, transform 0.42s, filter 0.42s;
    }

    &::before {
      z-index: -2;
      background: radial-gradient(ellipse at center, color-mix(in srgb, var(--nova-brand-primary) 26%, transparent) 0 26%, transparent 54%);
      filter: blur(28px);
    }

    &::after {
      z-index: -1;
      background: conic-gradient(
          from var(--nova-glow-angle),
          color-mix(in srgb, var(--nova-brand-primary) 0%, transparent) 0deg,
          color-mix(in srgb, var(--nova-brand-primary) 72%, transparent) 55deg,
          color-mix(in srgb, var(--nova-brand-info) 52%, transparent) 145deg,
          color-mix(in srgb, var(--nova-brand-secondary) 40%, transparent) 220deg,
          color-mix(in srgb, var(--nova-brand-primary) 72%, transparent) 300deg,
          color-mix(in srgb, var(--nova-brand-primary) 0%, transparent) 360deg
      );
      filter: blur(30px);
      animation: nova-orbit 5s linear infinite paused;
    }

    &.running::before {
      opacity: 0.92;
      filter: blur(22px);
      transform: translate(-50%, -50%) scale(1);
    }

    &.running::after {
      opacity: 1;
      filter: blur(22px);
      animation-play-state: running;
      transform: translate(-50%, -50%) scale(1);
    }
  }

  .queue {
    display: grid;
    gap: 2px;
    margin: 0 0 6px;
    padding: 4px;
    border: 1px solid var(--nova-subtle-border);
    border-radius: 10px;
    background: var(--nova-bg);
    list-style: none;

    li {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      padding: 1px 2px;
    }
  }

  .queue-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--nova-fg);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .queue .mode {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 2px;
    padding: 0 6px 0 3px;
    border: 1px solid var(--nova-subtle-border);
    border-radius: 999px;
    background: none;
    color: var(--nova-muted);
    font: inherit;
    font-size: 0.85em;
    cursor: pointer;

    &.steer {
      border-color: color-mix(in srgb, var(--nova-brand-primary) 50%, transparent);
      color: var(--nova-fg);
    }

    .codicon {
      font-size: 14px;
    }
  }

  .composer {
    position: relative;
    display: grid;
    gap: 4px;
    padding: 6px 6px 6px 8px;
    border: 1px solid var(--nova-input-border);
    border-radius: 14px;
    background: var(--nova-input-bg);
    transition: border-color 0.2s ease, box-shadow 0.3s ease;

    &:focus-within {
      border-color: var(--nova-focus);
    }
  }

  .running .composer {
    box-shadow: 0 2px 12px -6px color-mix(in srgb, var(--nova-brand-primary) 40%, transparent);
  }

  textarea {
    width: 100%;
    min-height: 22px;
    max-height: 240px;
    padding: 2px;
    border: 0;
    outline: none;
    resize: none;
    background: transparent;
    color: var(--nova-input-fg);
    font: inherit;
    line-height: 1.4;

    &::placeholder {
      color: var(--nova-input-placeholder);
    }
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }

  .spacer {
    flex: 1;
  }

  .icon {
    padding: 3px;
    border: 0;
    border-radius: var(--nova-radius);
    background: none;
    color: var(--nova-muted);
    cursor: pointer;

    &:hover {
      background: var(--nova-hover);
      color: var(--nova-fg);
    }
  }

  /* Size the dropdown to its selected option, not its longest one. */

  .mode {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 4px;
    color: var(--nova-muted);
    font-size: 0.9em;

    .codicon {
      font-size: 14px;
    }
  }

  /* Same footprint as the other toolbar icons; the accent color only shows when there is something to send. */
  .send {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    margin-left: 2px;
    padding: 0;
    border: 0;
    border-radius: var(--nova-radius);
    background: none;
    color: var(--nova-muted);
    cursor: pointer;

    &:not(:disabled) {
      color: var(--nova-link);
    }

    &:hover:not(:disabled) {
      background: var(--nova-hover);
    }

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }

    &.stop {
      color: var(--nova-brand-red);

      &:hover {
        background: color-mix(in srgb, var(--nova-brand-red) 15%, transparent);
      }
    }
  }

  .stop-square {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    background: currentColor;
  }

  @media (prefers-reduced-motion: reduce) {
    .composer-wrap {
      animation: none;

      &::after {
        animation: none;
      }
    }
  }

  /* High contrast: no glow; a clear dashed border shows that Nova is working instead. */
  @media (prefers-contrast: more), (forced-colors: active) {
    .composer-wrap::before,
    .composer-wrap::after {
      display: none;
    }

    .running .composer {
      border-style: dashed;
      border-width: 2px;
      box-shadow: none;
    }
  }

  @media (forced-colors: active) {
    .stop-square {
      forced-color-adjust: none;
      background: ButtonText;
    }
  }

  @media (max-width: 300px) {
    .mode-label {
      display: none;
    }
  }
</style>
