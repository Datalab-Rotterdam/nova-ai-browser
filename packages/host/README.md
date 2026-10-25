# Nova AI Browser host

The native messaging host of the [Nova AI browser extension](https://github.com/Datalab-Rotterdam/nova-ai-browser). It exposes the extension's browser tools as an MCP server (stdio and HTTP) to Nova AI for VS Code, nova-ai-cli, Claude Code and other ACP agents. It also installs the `nova-browser` skill, which tells agents how to use those tools.

While connected, it also keeps a copy of the side panel's saved chats in `~/.nova-ai/browser/sessions/` (one JSON file each, mode 0600), so agents can refer to past browser sessions. The extension's own storage stays the source of truth.

`dist/` is self-contained, with every dependency bundled, and is released with the extension at the same version.

```sh
node node_modules/@datalabrotterdam/nova-ai-browser-host/dist/cli.js install --auto
```

This registers the host with the installed Chromium browsers and installs the skill into `~/.nova-ai/skills` as a bundled skill (`"bundledBy": "Nova AI Browser"`). Nova apps run it at start-up.

Licensed under the Apache License 2.0, Copyright 2026 DataLab Rotterdam.
