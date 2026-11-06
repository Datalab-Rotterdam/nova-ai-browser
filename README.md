# Nova AI Browser

A Chromium extension (Chrome, Edge) that lets [Nova AI](https://nova.datalabrotterdam.nl) use your browser:
it clicks, types and reads pages while you watch its cursor. Other agents (Nova AI for VS Code, nova-ai-cli,
Claude Code) can use the same browser through MCP and ACP.

## Packages

| Package | What it is |
|---|---|
| `packages/extension` | The extension: service worker (browser tools), side panel (chat and agent loop), settings page, content scripts. Svelte 5 and Vite. |
| `packages/host` | Native messaging host: exposes the tools as an MCP server to other apps, installs the `nova-browser` skill. |
| `packages/protocol` | Types and pure logic shared by both: tool definitions, messages, context handling. |

## Develop

```sh
npm install
npm run dev -w @datalabrotterdam/nova-ai-browser-extension   # vite dev server
npm run build                                               # all packages; extension in packages/extension/dist
npm test                                                    # unit tests
npm run typecheck
npm run test:e2e                                            # loads the build in Chromium (NOVA_E2E_CHANNEL=msedge for Edge)
```

Load `packages/extension/dist` with Developer mode on, "Load unpacked" in `chrome://extensions` or `edge://extensions`.
The dev build carries a signing key so the extension id stays `lnoimoijcjpcebjepmenoepmhbdgnipo`, which the native host trusts.

The settings page uses `client-lib`, the Nova platform's UI library, as a git submodule at
`packages/extension/src/lib/client-lib` (public GitLab repository, licensed separately by its owner). Clone with
`git clone --recurse-submodules`, or run `git submodule update --init` afterwards.

## Release

```sh
npm run package:extension   # builds the store version (no dev key, no developer tools) into release/*.zip
```

Releases are cut with semantic-release; see `docs/STORE_LISTING.md` for the store text and `docs/PRIVACY.md` for the privacy policy.
Status and backlog: `docs/ROADMAP.md`, `docs/PLAN.md`.

## License

Apache 2.0, Copyright 2026 DataLab Rotterdam.
