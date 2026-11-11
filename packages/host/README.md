# Nova AI Browser host

The native messaging host of the [Nova AI browser extension](https://github.com/Datalab-Rotterdam/nova-ai-browser). It exposes the extension's browser tools as an MCP server (stdio and HTTP) to Nova AI for VS Code, nova-ai-cli, Nova AI Desktop, Claude Code and other ACP agents. The `nova-browser` skill, which tells agents how to use those tools, ships in [@datalabrotterdam/nova-ai-skills](https://github.com/Datalab-Rotterdam/nova-ai-skills); `install --skills claude,codex,agents` also writes it for agents outside Nova.

While connected, it also keeps a copy of the side panel's saved chats in `~/.nova-ai/browser/sessions/` (one JSON file each, mode 0600), so agents can refer to past browser sessions. The extension's own storage stays the source of truth.

`dist/` is self-contained, with every dependency bundled, and is released with the extension at the same version.

```sh
node node_modules/@datalabrotterdam/nova-ai-browser-host/dist/cli.js install --auto
```

This registers the host with the installed Chromium browsers. Nova apps run it at start-up. Nova AI Desktop carries the host instead (`install --carrier`): it registers its own executable, so the browser needs no Node.

Licensed under the Apache License 2.0, Copyright 2026 DataLab Rotterdam.
