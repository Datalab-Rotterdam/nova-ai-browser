<script lang="ts">
    // A smaller nova-ai-vscode webview/src/chat/ChatsPage.svelte: search, open and delete.
    import { onMount } from 'svelte';
    import { allSessions, deleteSession, type StoredSession } from '../../lib/sessions';

    let { currentId, running, onopen, ondeleted }: {
        currentId: string;
        running: boolean;
        onopen: (id: string) => void;
        ondeleted: (id: string) => void;
    } = $props();

    const DAY = 24 * 60 * 60_000;

    let sessions = $state<StoredSession[]>([]);
    let query = $state('');

    const shown = $derived.by(() => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        return sessions.filter((chat) => words.every((word) => chat.title.toLowerCase().includes(word)));
    });

    onMount(() => {
        void allSessions().then((list) => (sessions = list));
    });

    async function remove(chat: StoredSession) {
        if (!confirm(`Delete "${chat.title || 'Untitled chat'}"?`)) return;
        await deleteSession(chat.id);
        sessions = sessions.filter((other) => other.id !== chat.id);
        ondeleted(chat.id);
    }

    /** "now", "5m", "3h", "2d", then a date (nova-ai-vscode src/panel/chatGroups.ts `formatAge`). */
    function age(updatedAt: number): string {
        const elapsed = Math.max(0, Date.now() - updatedAt);
        if (elapsed < 60_000) return 'now';
        if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}m`;
        if (elapsed < DAY) return `${Math.floor(elapsed / (60 * 60_000))}h`;
        if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;
        const date = new Date(updatedAt);
        const sameYear = date.getFullYear() === new Date().getFullYear();
        return date.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
    }

    const focus = (node: HTMLInputElement) => node.focus();
</script>

<div class="chats">
    <div class="search">
        <span class="codicon codicon-search" aria-hidden="true"></span>
        <input bind:value={query} type="search" placeholder="Search chats" aria-label="Search chats" use:focus />
    </div>

    {#if running}<p class="hint">Stop Nova to open another chat.</p>{/if}

    <ul class="list" aria-label="Chats">
        {#each shown as chat (chat.id)}
            <li class="row" class:current={chat.id === currentId}>
                <button
                        class="open"
                        title={`${chat.title}\nLast used ${new Date(chat.updatedAt).toLocaleString()}`}
                        disabled={running && chat.id !== currentId}
                        onclick={() => onopen(chat.id)}
                >
                    <span class="title">{chat.title || 'Untitled chat'}</span>
                    <span class="age">{chat.id === currentId ? 'open' : age(chat.updatedAt)}</span>
                </button>
                <button
                        class="nova-icon-button codicon codicon-trash delete"
                        title="Delete chat"
                        aria-label={`Delete ${chat.title || 'Untitled chat'}`}
                        disabled={chat.id === currentId && running}
                        onclick={() => remove(chat)}
                ></button>
            </li>
        {/each}
    </ul>

    {#if !sessions.length}
        <p class="empty">No saved chats yet.</p>
    {:else if !shown.length}
        <p class="empty">No chats match “{query}”.</p>
    {/if}
</div>

<style lang="scss">
  .chats {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px 12px;
    padding: 0 6px 0 8px;
    border: 1px solid var(--nova-input-border, var(--nova-border));
    border-radius: var(--nova-radius-large);
    background: var(--nova-input-bg);
    color: var(--nova-input-fg, var(--nova-fg));

    &:focus-within {
      border-color: var(--nova-focus);
    }

    .codicon-search {
      color: var(--nova-muted);
    }

    input {
      flex: 1;
      min-width: 0;
      padding: 6px 0;
      border: 0;
      outline: none;
      background: none;
      color: inherit;
      font: inherit;

      &::placeholder {
        color: var(--nova-input-placeholder, var(--nova-muted));
      }
    }
  }

  .hint,
  .empty {
    margin: 4px 12px;
    color: var(--nova-muted);
    font-size: 0.9em;
  }

  .list {
    margin: 0;
    padding: 0 0 8px;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    margin: 0 6px;
    border-radius: var(--nova-radius);

    &:hover {
      background: var(--nova-hover);
      color: var(--nova-hover-fg, inherit);
    }

    &.current .title {
      font-weight: 600;
    }

    /* Shown on hover; opacity, not visibility, so it stays reachable with Tab. */
    .delete {
      flex: none;
      margin-right: 4px;
      opacity: 0;
    }

    &:hover .delete,
    .delete:focus-visible {
      opacity: 1;
    }
  }

  .open {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 5px 6px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;

    &:disabled {
      cursor: default;
      opacity: 0.6;
    }

    &:focus-visible {
      outline: 1px solid var(--nova-focus);
      outline-offset: -1px;
      border-radius: var(--nova-radius);
    }
  }

  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .age {
    flex: none;
    color: var(--nova-muted);
    font-size: 0.85em;
  }
</style>
