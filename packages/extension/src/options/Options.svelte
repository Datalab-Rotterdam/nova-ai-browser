<script lang="ts">
    import { onDestroy } from 'svelte';
    import markUrl from '../assets/nova-mark.svg?url';
    import { Brand, Card, Main, Navbar, Page, Sidebar, SidebarGroup, SidebarItem, ThemeToggler } from '$lib/client-lib/components';
    import { isMobile } from '$lib/client-lib/helpers/sizes.helper';
    import type { Icons } from '$lib/client-lib/components/icons/Icon.svelte';
    import Button from '$lib/client-lib/components/actions/Button.svelte';
    import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged, saveSettings, type Settings as SettingsData } from '../lib/settings';
    import { ChatSession } from '../sidepanel/chat.svelte';
    import Settings from '../sidepanel/components/Settings.svelte';
    import Shortcuts from './Shortcuts.svelte';

    type Page = 'general' | 'shortcuts' | 'permissions' | 'agents' | 'advanced';

    const PAGES: Array<{ id: Page; label: string; icon: Icons; title: string; description: string }> = [
        { id: 'general', label: 'General', icon: 'sliders', title: 'General', description: 'The model Nova uses, how it reads pages and how you open it.' },
        { id: 'shortcuts', label: 'Shortcuts', icon: 'lightning-charge', title: 'Shortcuts', description: 'Saved prompts you run with /name or on a schedule.' },
        { id: 'permissions', label: 'Permissions', icon: 'shield-check', title: 'Permissions', description: 'Which websites Nova may use, and when it asks.' },
        { id: 'agents', label: 'Other AI apps', icon: 'plug', title: 'Other AI apps', description: 'Let other apps use this browser through Nova.' },
        { id: 'advanced', label: 'Advanced', icon: 'gear', title: 'Advanced', description: 'Scripts, limits, the server address and developer tools.' }
    ];

    const chat = new ChatSession();
    let settings = $state<SettingsData>(DEFAULT_SETTINGS);
    let loaded = $state(false);
    let collapsed = $state(false);
    let shortcut = $state<string | undefined>();

    let welcome = $state(location.hash === '#welcome');

    const initial = location.hash.slice(1) as Page;
    let page = $state<Page>(PAGES.some((entry) => entry.id === initial) ? initial : 'general');

    function dismissWelcome() {
        welcome = false;
        history.replaceState(null, '', `#${page}`);
    }

    function show(next: Page) {
        welcome = false;
        page = next;
        history.replaceState(null, '', `#${next}`);
    }

    void loadSettings().then((value) => {
        settings = value;
        loaded = true;
        void chat.loadModels(value);
    });
    const stop = onSettingsChanged((next) => {
        const reload = next.apiKey !== settings.apiKey || next.baseUrl !== settings.baseUrl;
        settings = next;
        if (reload) void chat.loadModels(next);
    });

    async function loadShortcut() {
        const commands = await chrome.commands.getAll();
        shortcut = commands.find((command) => command.name === 'toggle-panel')?.shortcut || undefined;
    }
    void loadShortcut();
    // Coming back from the browser's shortcut page: pick up what the user set.
    window.addEventListener('focus', loadShortcut);
    onDestroy(() => {
        stop();
        window.removeEventListener('focus', loadShortcut);
    });

    // Nova's panel is not needed next to its own settings.
    void chrome.tabs.getCurrent().then((tab) => {
        if (tab?.id !== undefined) void chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false }).catch(() => undefined);
    });

    const SHORTCUTS_URL = navigator.userAgent.includes('Edg/') ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts';

    function configureShortcut() {
        void chrome.tabs.create({ url: SHORTCUTS_URL });
    }

    async function signOut() {
        await saveSettings({ apiKey: '' });
    }

    const current = $derived(PAGES.find((entry) => entry.id === page) ?? PAGES[0]);
    const keyPreview = $derived(settings.apiKey ? `${settings.apiKey.slice(0, 7)}…${settings.apiKey.slice(-4)}` : '');
</script>

<Brand shell text="Nova AI" hideText={collapsed} aria-label="Nova AI settings">
    {#snippet icon()}<span class="nova-mark brand-mark" style:--mark-url={`url("${markUrl}")`} aria-hidden="true"></span>{/snippet}
</Brand>

{#snippet welcomeCard()}
    {#if welcome}
        <Card title="Welcome to Nova AI" description="Four things to know before you start.">
            <ol class="welcome">
                <li><strong>Open Nova</strong> with {#if shortcut}<kbd>{shortcut}</kbd>{:else}the toolbar icon{/if}. Press it again to close.</li>
                <li><strong>Sign in</strong> with your Nova API key in the side panel.</li>
                <li><strong>Nova works in its own tab group.</strong> Press "Use this tab" in the panel to let it work on the page you are looking at.</li>
                <li><strong>You stay in control.</strong> Nova asks before it uses a website for the first time and before anything it cannot undo, and Stop always works. Select text on a page and right-click, or type <kbd>nova</kbd> in the address bar, to ask about it.</li>
            </ol>
            <div><Button variant="primary" onclick={dismissWelcome}>Got it</Button></div>
        </Card>
    {/if}
{/snippet}

{#if loaded && settings.apiKey}
    <Navbar>
        <div class="crumbs"><span>Settings</span><span class="sep">/</span><strong>{current.label}</strong></div>
        {#if !$isMobile}
            <nav class="actions" aria-label="Global actions">
                <span class="account" title="Your API key"><i class="bi bi-check-circle-fill ok" aria-hidden="true"></i>Signed in <code>{keyPreview}</code></span>
                <ThemeToggler />
            </nav>
        {/if}
    </Navbar>

    <Sidebar bind:collapsed>
        <SidebarGroup title="Settings">
            {#each PAGES as entry (entry.id)}
                <SidebarItem icon={entry.icon} text={entry.label} active={page === entry.id} onclick={() => show(entry.id)} hideSidebarOnMobile />
            {/each}
        </SidebarGroup>
        {#snippet footer()}
            {#if $isMobile}
                <div class="drawer-account">
                    <span class="account" title="Your API key"><i class="bi bi-check-circle-fill ok" aria-hidden="true"></i>Signed in <code>{keyPreview}</code></span>
                    <ThemeToggler />
                </div>
            {/if}
            <SidebarItem icon="shield-lock" text="Privacy policy" href="https://datalabrotterdam.com/privacy-policy" target="_blank" rel="noopener" />
            <SidebarItem icon="box-arrow-right" text="Sign out" onclick={signOut} />
        {/snippet}
    </Sidebar>

    <Main>
        <Page title={current.title} description={current.description} fit breakpoints>
            <div class="stack">
                {@render welcomeCard()}
                {#if page === 'shortcuts'}
                    <Shortcuts {settings} />
                {:else}
                <Settings {settings} models={chat.models} modelsError={chat.modelsError} onreloadmodels={() => chat.loadModels(settings)} {page} />
                {/if}
                {#if page === 'general'}
                    <Card title="Keyboard shortcut" description="Opens and closes the Nova side panel in the current window.">
                        <div class="shortcut">
                            <div>
                                <div class="label">Open / close side panel</div>
                                <div class="value">{#if shortcut}<kbd>{shortcut}</kbd>{:else}No shortcut configured{/if}</div>
                            </div>
                            <Button variant="default" class="configure" onclick={configureShortcut}><i class="bi bi-keyboard" style="margin-right: 8px"></i>Configure</Button>
                        </div>
                    </Card>
                {/if}
            </div>
        </Page>
    </Main>
{:else if loaded}
    <Main>
        <Page title="Nova AI settings">
            {@render welcomeCard()}
            <Card title="Sign in" description="Open the Nova side panel and enter your API key to get started. The settings show up here afterwards." />
        </Page>
    </Main>
{/if}

<style lang="scss">
  .brand-mark {
    display: inline-block;
    width: 28px;
    height: 28px;
  }

  .crumbs {
    display: flex;
    align-items: center;
    gap: 8px;

    .sep {
      color: var(--color-text-muted);
    }
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .drawer-account {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    flex-wrap: wrap;
  }

  .account {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text-secondary);
  }

  .ok {
    color: var(--color-success);
  }

  .welcome {
    display: grid;
    gap: 8px;
    margin: 0 0 8px;
    padding-left: 20px;
  }

  .stack {
    display: grid;
    gap: 16px;
  }

  .shortcut {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;

    .label {
      font-weight: 600;
    }

    .value {
      margin-top: 2px;
      color: var(--color-text-muted);
    }
  }

  kbd {
    padding: 1px 8px;
    border: 1px solid var(--color-border-primary);
    border-radius: 4px;
    background: var(--color-background-tertiary);
    font-family: inherit;
  }
</style>
