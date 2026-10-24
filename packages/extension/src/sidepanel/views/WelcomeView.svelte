<script lang="ts">
    // Same layout as nova-ai-vscode's webview/src/views/WelcomeView.svelte.
    import datalabUrl from '../../assets/datalab-logo.svg?url';
    import markUrl from '../../assets/nova-mark.svg?url';

    let { onGetStarted }: { onGetStarted: () => void } = $props();

    const docsUrl = 'https://docs.datalabrotterdam.nl/services/nova-ai';
</script>

<section class="welcome">
    <div class="intro">
        <span class="nova-mark logo" style:--mark-url={`url("${markUrl}")`} aria-hidden="true"></span>
        <h1>Nova AI</h1>
        <p>Let Nova use your browser: it reads pages, clicks and types while you watch.</p>
    </div>

    <ul class="features">
        <li><span class="codicon codicon-target" aria-hidden="true"></span>See every step: Nova's cursor moves over the page</li>
        <li><span class="codicon codicon-layers" aria-hidden="true"></span>Works only in the "Nova" tab group you give it</li>
        <li><span class="codicon codicon-shield" aria-hidden="true"></span>Asks before using a new site; stop it any time</li>
        <li><span class="codicon codicon-plug" aria-hidden="true"></span>Also usable from VS Code and other agents</li>
    </ul>

    <div class="actions">
        <button class="nova-button" onclick={onGetStarted}>Connect Nova AI</button>
        <a href={docsUrl} target="_blank" rel="noreferrer">Read the documentation</a>
    </div>

    <footer>
        <span class="nova-mark datalab" style:--mark-url={`url("${datalabUrl}")`} role="img" aria-label="DataLab Rotterdam"></span>
    </footer>
</section>

<style lang="scss">
  .welcome {
    min-height: 100%;
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 28px 20px 16px;
  }

  .intro {
    display: grid;
    justify-items: center;
    gap: 8px;
    text-align: center;
  }

  .logo {
    width: 40px;
    height: 40px;
    color: var(--nova-fg);
  }

  h1 {
    margin: 4px 0 0;
    font-size: 1.3em;
    font-weight: 600;
  }

  p {
    max-width: 32ch;
    color: var(--nova-muted);
  }

  .features {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: grid;
      grid-template-columns: 16px 1fr;
      gap: 8px;
      align-items: start;
      color: var(--nova-fg);
    }

    .codicon {
      margin-top: 1px;
      color: var(--nova-muted);
    }
  }

  .actions {
    display: grid;
    justify-items: center;
    gap: 10px;
  }

  footer {
    margin-top: auto;
    display: flex;
    justify-content: center;
    padding-top: 12px;
    color: var(--nova-muted);
    opacity: 0.7;
  }

  .datalab {
    width: 110px;
    height: 32px;
  }
</style>
