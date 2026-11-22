# Nova AI Browser

A Chromium extension (Chrome, Edge) that lets [Nova AI](https://nova.datalabrotterdam.nl) use your browser:
it clicks, types and reads pages while you watch its cursor. Other agents (Nova AI for VS Code, nova-ai-cli,
Claude Code) can use the same browser through MCP and ACP.

Right-click a web page and choose **Watch this page** to track changes in its main text. Nova skips
common navigation, banners and timestamp elements. To track a price, deadline or status, select the
text and choose **Watch selected text**. Open **Settings → Watchlist** to check now or view changes.
Watches run about once an hour while the browser is open and use your current browser session.

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

Releases are cut with semantic-release on `main`; each GitHub release has the store zip attached. The store uploads are opt-in through repository variables:

- Chrome Web Store: `PUBLISH_CHROME_EXTENSION=true`, secrets `CWS_EXTENSION_ID`, `CWS_PUBLISHER_ID`, `CWS_CLIENT_ID`,
  `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`. `npm run publish:chrome` (or `-- --no-publish` to upload only) uploads and
  publishes. While an earlier version is in review or approved but not yet published, the upload is skipped and the
  release does not fail; upload that release's zip in the developer dashboard afterwards.
- Edge Add-ons: `PUBLISH_EDGE_EXTENSION=true`, secrets `EDGE_PRODUCT_ID` (the product GUID in Partner Center),
  `EDGE_CLIENT_ID` and `EDGE_API_KEY` (Partner Center, Microsoft Edge, Publish API; the key expires). The first
  version has to be published by hand in Partner Center; `npm run publish:edge` (or `-- --no-submit` for a draft only)
  uploads and submits later versions. While an earlier version is in review, the upload stays in the draft (submit it
  in Partner Center later) and the release does not fail.

After changing a store secret, run the "Check store credentials" workflow (Actions, Run workflow) or
`node scripts/check-store-credentials.mjs` with the same environment variables: it signs in and reads the store
status without uploading anything.

See `docs/STORE_LISTING.md` for the store text and `docs/PRIVACY.md` for the privacy policy.
Status and backlog: `docs/ROADMAP.md`, `docs/PLAN.md`.

## License

Apache 2.0, Copyright 2026 DataLab Rotterdam.
