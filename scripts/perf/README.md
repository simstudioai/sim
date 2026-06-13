# Chat performance harness

Headless-Chromium tooling for measuring and validating Mothership chat
performance against a local dev server. Built to investigate (and prove the fix
for) transcript slowdown in long chats.

All scripts authenticate by minting a Better Auth session cookie from a live
`session` row in the local DB + `BETTER_AUTH_SECRET` — no login flow needed. Run
them from the repo root after `bun install` (Playwright is a dependency).

## chat-load-perf.mjs

Loads a chat and reports: chat GET API time/size, time-to-first-row,
time-to-all-rows, DOM node count, JS heap, main-thread long tasks, and
per-keystroke input latency.

```bash
node scripts/perf/chat-load-perf.mjs --chat <chatId> --workspace <workspaceId> \
  [--base http://localhost:3000] [--runs 3] [--react-scan] [--send]
```

- `--react-scan` injects [react-scan](https://github.com/aidenybai/react-scan)
  into the test browser and prints per-component render counts/self-time for the
  load, idle-typing, and streaming phases. Requires the bundle at
  `/tmp/react-scan-auto.global.js` (`curl -sL https://unpkg.com/react-scan/dist/auto.global.js -o /tmp/react-scan-auto.global.js`).
- `--send` posts a real message and measures typing latency while the assistant
  streams.

## seed-chat-scale.mjs

Clones an existing chat's messages cyclically into new `PERF n=<size>` chats so
load can be measured across transcript sizes. Rewrites `message_id` and
`content.id` (the client's React key) per copy.

```bash
node scripts/perf/seed-chat-scale.mjs --source <chatId> --sizes 32,258,516,1032
# cleanup: delete from copilot_chats where title like 'PERF n=%';
```

## stream-validate.mjs

Opens a fresh chat, sends a prompt, and asserts the streaming reply grows
monotonically while the container stays pinned to the bottom — the two behaviors
most at risk from virtualizing the message list. Requires a reachable copilot
agent backend (won't produce a stream if the agent is unreachable).

```bash
node scripts/perf/stream-validate.mjs --workspace <workspaceId> [--base http://localhost:3000]
```
