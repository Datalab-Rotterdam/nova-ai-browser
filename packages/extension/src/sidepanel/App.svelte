<script lang="ts">
    import { onDestroy, tick } from 'svelte';
    import markUrl from '../assets/nova-mark.svg?url';
    import { addCurrentTab, connectPanel } from '../lib/bridge';
    import { DEV_TOOLS } from '../lib/build';
    import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged, saveSettings, type Settings as SettingsData } from '../lib/settings';
    import { ChatSession } from './chat.svelte';
    import Composer from './components/Composer.svelte';
    import Markdown from './components/Markdown.svelte';
    import PermissionCard from './components/PermissionCard.svelte';
    import Settings from './components/Settings.svelte';
    import ToolCard from './components/ToolCard.svelte';
    import ToolTester from './components/ToolTester.svelte';
    import ConnectView from './views/ConnectView.svelte';
    import WelcomeView from './views/WelcomeView.svelte';

    type View = 'chat' | 'tools' | 'settings';

    const chat = new ChatSession();
    let settings = $state<SettingsData>(DEFAULT_SETTINGS);
    let loaded = $state(false);
    let view = $state<View>('chat');
    let connecting = $state(false);
    let showConnect = $state(false);
    let connectError = $state<string | undefined>();
    let input = $state('');
    let scroller: HTMLElement | undefined = $state();
    let toast = $state<string | undefined>();

    const signedIn = $derived(Boolean(settings.apiKey));
    const vision = $derived(chat.visionFor(settings));
    const modelName = $derived(chat.models.find((m) => m.id === settings.model)?.name ?? settings.model);
    const lastIsUser = $derived(chat.items[chat.items.length - 1]?.kind === 'user');

    void loadSettings().then(async (value) => {
        settings = value;
        loaded = true;
        await chat.loadModels(value);
    });
    const stopSettings = onSettingsChanged((next) => {
        const reload = next.apiKey !== settings.apiKey || next.baseUrl !== settings.baseUrl;
        settings = next;
        if (reload) void chat.loadModels(next);
    });
    const stopPort = connectPanel((event) => {
        chat.handleEvent(event);
        // Questions for the user must be visible, whatever page of the panel is open.
        if (event.type === 'permission/request') view = 'chat';
    });
    onDestroy(() => {
        stopSettings();
        stopPort();
    });

    // Keep the newest message in view while Nova works.
    $effect(() => {
        const last = chat.items[chat.items.length - 1];
        void chat.items.length;
        void (last && 'text' in last ? last.text : last);
        void chat.running;
        void tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
    });

    async function connect(apiKey: string) {
        connecting = true;
        connectError = await chat.connect(apiKey, settings);
        connecting = false;
        if (!connectError) showConnect = false;
    }

    async function signOut() {
        chat.newChat();
        await saveSettings({ apiKey: '' });
        view = 'chat';
    }

    async function useThisTab() {
        try {
            await addCurrentTab();
            flash('Nova can now use this tab.');
        } catch (error) {
            flash((error as Error).message);
        }
    }

    function flash(text: string) {
        toast = text;
        setTimeout(() => (toast = undefined), 2500);
    }

    function toggle(next: View) {
        view = view === next ? 'chat' : next;
    }

    const EXAMPLES = [
        'Summarize this page in five bullet points',
        'Find the opening hours of the Markthal in Rotterdam',
        'Fill in the form on this page with test data, but do not submit it'
    ];
</script>

{#if !loaded}
    <div class="loader" aria-busy="true"></div>
{:else if !signedIn}
    {#if showConnect}
        <ConnectView busy={connecting} error={connectError} onConnect={connect} onBack={() => (showConnect = false)} />
    {:else}
        <WelcomeView onGetStarted={() => (showConnect = true)} />
    {/if}
{:else}
    <section class="chat">
        <header>
            <span class="nova-mark header-mark" style:--mark-url={`url("${markUrl}")`} aria-hidden="true"></span>
            <span class="title">{view === 'settings' ? 'Settings' : view === 'tools' ? 'Tool tester' : 'Nova'}</span>
            {#if view === 'chat'}
                <button class="nova-icon-button codicon codicon-add" title="New chat" aria-label="New chat" disabled={!chat.items.length} onclick={() => chat.newChat()}></button>
            {/if}
            {#if DEV_TOOLS}
                <button class="nova-icon-button codicon codicon-beaker" title="Tool tester" aria-label="Tool tester" aria-pressed={view === 'tools'} onclick={() => toggle('tools')}></button>
            {/if}
            <button class="nova-icon-button codicon codicon-settings-gear" title="Settings" aria-label="Settings" aria-pressed={view === 'settings'} onclick={() => toggle('settings')}></button>
        </header>

        {#if view === 'settings'}
            <div class="page">
                <Settings {settings} models={chat.models} modelsError={chat.modelsError} onreloadmodels={() => chat.loadModels(settings)} onsignout={signOut} />
            </div>
        {:else if DEV_TOOLS && view === 'tools'}
            <div class="page"><ToolTester /></div>
        {:else}
            <div class="items" bind:this={scroller}>
                <div class="content" aria-live="polite">
                    {#if !chat.items.length}
                        <div class="empty">
                            <span class="codicon codicon-sparkle" aria-hidden="true"></span>
                            <p>Ask Nova to do something in your browser. It works in the “Nova” tab group, asks before using a new site, and you can stop it at any time.</p>
                            <div class="examples">
                                {#each EXAMPLES as example (example)}
                                    <button class="example" onclick={() => (input = example)}>
                                        <span class="codicon codicon-arrow-right" aria-hidden="true"></span>{example}
                                    </button>
                                {/each}
                            </div>
                        </div>
                    {/if}

                    {#each chat.items as item, index (item.id)}
                        {#if index > 0 && chat.items[index - 1].kind === 'user' && item.kind !== 'user'}
                            <div class="reply-header">
                                <span class="nova-mark reply-mark" style:--mark-url={`url("${markUrl}")`} aria-hidden="true"></span>
                                <span class="reply-model">{modelName}</span>
                                {#if chat.running && index === chat.items.length - 1}<span class="live-dot" aria-label="Working"></span>{/if}
                            </div>
                        {/if}

                        {#if item.kind === 'user'}
                            <div class="user" class:steered={item.steered}>
                                {#if item.steered}<span class="steered-label"><span class="codicon codicon-arrow-small-right" aria-hidden="true"></span>Steered</span>{/if}
                                <p>{item.text}</p>
                            </div>
                        {:else if item.kind === 'assistant'}
                            {#if item.thinking}
                                <details class="thinking">
                                    <summary><span class="codicon codicon-lightbulb" aria-hidden="true"></span>Thinking</summary>
                                    <p>{item.thinking}</p>
                                </details>
                            {/if}
                            {#if item.text}<div class="assistant"><Markdown text={item.text} /></div>{/if}
                        {:else if item.kind === 'tool'}
                            <ToolCard name={item.call.name} args={item.call.args} result={item.result} />
                        {:else if item.kind === 'permission'}
                            <PermissionCard subject={item.subject} target={item.target} agent={item.agent} summary={item.summary} answered={item.answered}
                                            onanswer={(decision) => chat.answer(item, decision)} />
                        {:else}
                            <p class={`notice ${item.tone}`}>
                                <span class={`codicon codicon-${item.tone === 'error' ? 'error' : 'info'}`} aria-hidden="true"></span>{item.text}
                            </p>
                        {/if}
                    {/each}

                    {#if chat.running}
                        {#if lastIsUser}
                            <div class="reply-header">
                                <span class="nova-mark reply-mark" style:--mark-url={`url("${markUrl}")`} aria-hidden="true"></span>
                                <span class="reply-model">{modelName}</span>
                                <span class="live-dot" aria-label="Working"></span>
                            </div>
                        {/if}
                        <div class="working" aria-label="Nova is working"><span class="shimmer">Working…</span></div>
                    {/if}
                </div>
            </div>

            {#if toast}<p class="toast" role="status">{toast}</p>{/if}

            <Composer
                    bind:value={input}
                    queue={chat.queue}
                    onqueuemode={(id, mode) => chat.setQueueMode(id, mode)}
                    onqueueremove={(id) => chat.removeQueued(id)}
                    onqueuesendnow={(id) => chat.sendQueuedNow(id, settings)}
                    running={chat.running}
                    disabled={!settings.model}
                    models={chat.models.filter((m) => !(m.capabilities ?? []).some((c) => /embedding|audio/.test(c)))}
                    modelId={settings.model}
                    {vision}
                    onsend={(text) => chat.send(text, settings)}
                    onstop={() => chat.stop('Stopped.')}
                    onmodel={(model) => saveSettings({ model })}
                    onusetab={useThisTab}
            />
        {/if}
    </section>
{/if}

<style lang="scss">
  .loader {
    height: 100%;
  }

  .chat {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 8px 4px 12px;
    border-bottom: 1px solid var(--nova-border);
  }

  .header-mark {
    width: 16px;
    height: 16px;
    margin-right: 6px;
    color: var(--nova-fg);
  }

  .title {
    flex: 1;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .page,
  .items {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .content {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
  }

  .empty {
    display: grid;
    justify-items: center;
    gap: 8px;
    margin: auto 0;
    padding: 24px 8px;
    color: var(--nova-muted);
    text-align: center;

    > .codicon {
      font-size: 24px;
    }
  }

  .examples {
    display: grid;
    gap: 4px;
    width: 100%;
    margin-top: 8px;
  }

  .example {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border: 1px solid var(--nova-subtle-border);
    border-radius: var(--nova-radius-large);
    background: var(--nova-surface);
    color: var(--nova-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;

    .codicon {
      flex: none;
      color: var(--nova-muted);
    }

    &:hover {
      background: var(--nova-hover);
      color: var(--nova-hover-fg);
    }
  }

  .user {
    align-self: flex-end;
    max-width: 90%;
    margin-bottom: 6px;
    padding: 6px 10px;
    border-radius: var(--nova-radius-large);
    background: var(--nova-request-bg);
    border: 1px solid var(--nova-subtle-border);

    p {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  }

  .steered-label {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-bottom: 2px;
    color: var(--nova-muted);
    font-size: 0.85em;
  }

  .thinking {
    color: var(--nova-muted);

    summary {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
    }

    p {
      margin-top: 4px;
      padding-left: 10px;
      border-left: 2px solid var(--nova-subtle-border);
      white-space: pre-wrap;
      font-size: 0.92em;
    }
  }

  .notice {
    display: flex;
    gap: 6px;
    color: var(--nova-muted);
    font-size: 0.92em;

    &.error .codicon {
      color: var(--nova-error);
    }
  }

  .reply-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: -4px;
    font-weight: 600;
  }

  .reply-mark {
    width: 16px;
    height: 16px;
    color: var(--nova-fg);
  }

  .reply-model {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .live-dot {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: var(--nova-brand-primary);
    animation: nova-pulse 1.6s ease-in-out infinite;
  }

  .working {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--nova-muted);
  }

  /* Text shimmer: a highlight sweeping through the label. */
  .shimmer {
    background: linear-gradient(
        90deg,
        var(--nova-muted) 0%,
        var(--nova-muted) 40%,
        var(--nova-fg) 50%,
        var(--nova-muted) 60%,
        var(--nova-muted) 100%
    );
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: nova-shimmer 1.8s linear infinite;
  }

  .toast {
    flex: none;
    margin: 0 10px;
    padding: 4px 8px;
    border-radius: var(--nova-radius);
    background: var(--nova-badge-bg);
    color: var(--nova-badge-fg);
    font-size: 0.92em;
  }

  /* Reduced motion: the shimmer becomes static text, the live dot stops pulsing. */
  @media (prefers-reduced-motion: reduce) {
    .shimmer {
      background: none;
      color: var(--nova-muted);
    }
  }

  @media (forced-colors: active) {
    .shimmer {
      background: none;
      color: CanvasText;
    }

    .live-dot {
      forced-color-adjust: none;
      background: Highlight;
    }
  }
</style>
