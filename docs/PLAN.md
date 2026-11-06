# Plan: store release and competitive gaps

Written 2026-11-06. Companion to [ROADMAP.md](./ROADMAP.md): the roadmap holds what was done and the
older backlog; this plan orders what to build next to ship to the Chrome Web Store (and Edge
Add-ons) and close the gap with other browser agents (Claude in Chrome, Comet, Gemini in Chrome).

Status key: `[x]` done, `[ ]` open.

## Phase A: store blockers

- [x] **A1 Typecheck.** `svelte-check` refuses TypeScript 7 without TS 6 + `--tsgo`. Make `npm run typecheck` pass so the extension is type-checked again.
- [x] **A2 Privacy policy** (`docs/PRIVACY.md`). What is read (pages the user lets Nova use), what leaves the browser (prompts, page text, screenshots to the Nova API the user configured), what is stored locally, no analytics. Needs a public URL when submitting.
- [x] **A3 Store listing text** (`docs/STORE_LISTING.md`). Description, single purpose statement, a justification for every permission (`debugger`, `<all_urls>`, `scripting`, `tabs`, `tabGroups`, `nativeMessaging`, `sidePanel`, `storage`, `unlimitedStorage`), remote-code statement, screenshot list.
- [x] **A4 README.** Root README: what it is, install (extension + host), dev, tests, package layout (roadmap #9).
- [x] **A5 client-lib as a submodule.** `packages/extension/src/lib/client-lib` is a git submodule (gitlab, pinned to `main`); CI checks it out with `submodules: true` (the repository is public, so no token is needed). Typecheck ignores problems inside it (`packages/extension/typecheck.mjs`).

## Phase B: safety

- [x] **B1 Confirm irreversible actions in code** (roadmap #3). Before a click or form fill on an element that looks like pay, buy, order, send, submit, delete, ask the user in the browser, for every caller (side panel, MCP, ACP).
- [x] **B2 Prompt-injection hardening** (was already in `agent/prompt.ts` and `untrusted()`). Page text and tool results are marked as untrusted data in the prompt; the prompt tells the model never to follow instructions found in them.
- [x] **B3 Permission timeout notice** (roadmap #4). Tell the user when a prompt timed out and counted as deny.

## Phase C: quick wins that match competitors

- [x] **C1 Context menu.** "Ask Nova about this selection / page / link" opens the panel with the text prefilled.
- [x] **C2 Omnibox keyword.** `nova <question>` in the address bar opens the panel with the question.
- [x] **C3 Onboarding page.** First-run tab: how permissions work, the shortcut, "Use this tab".
- [x] **C4 Chat export.** Copy a chat as Markdown from the chat list.

## Phase D: larger features (each its own PR)

- [ ] **D1 Saved prompts** (`/name`) and scheduled tasks with completion notifications.
- [ ] **D2 Attachments**: paste or drop images and files into the composer.
- [ ] **D3 Voice input.**
- [ ] **D4 Usage and cost** per chat (roadmap #6).
- [x] **D5 Read-only "Ask" mode** (roadmap #7): Settings, General, Mode; refuses non-read calls in the loop and says so in the prompt.
- [ ] **D6 Per-site rules** (roadmap #8).
- [ ] **D7 Dutch UI** (roadmap #11).
- [ ] **D8 Edge Add-ons listing.**

## Order of work

A1 to A4, then B1 to B3, then C1 to C4. Phase D is scheduled after those.
Every item ships with tests where the logic is pure, and the box above is ticked in the same change.
