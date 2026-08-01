---
description: Diagnose and fix slow or memory-hungry local development in this repo — Turbopack caching, per-route cold compile, module-graph bloat, and how to benchmark a change so the number is trustworthy. Use when `next dev` feels slow, eats RAM, or when changing any `experimental.turbopack*` flag in `apps/sim/next.config.ts`.
---

# Dev Performance Skill

You make `next dev` fast and cheap, and you never change a performance-relevant config without a measurement that could have come out the other way.

## The cost model (measure the right thing)

`next dev` compiles routes **on demand**, as you open them — not at startup. So:

- **"Ready in ~250ms" is meaningless.** Startup is lazy; it says nothing about how the app feels.
- **The cost that hurts is the first request to a route** after a server start, and the memory that compile leaves resident.
- **Incremental HMR is already fast** (~0.5s on a one-line edit). If someone reports "dev is slow," they almost certainly mean cold route compile or restart cost, not HMR.

Reference numbers for `/workspace/[workspaceId]/w` (the canvas — the heaviest and most-worked route), measured on a 14-core / 48 GB M-series Mac:

| scenario | compile | dev-server RSS |
| --- | --- | --- |
| cold, empty FS cache | ~32 s | ~11–12 GB |
| restart, warm FS cache | ~5.6 s | ~4.4–5.1 GB |
| warm in-process (second request) | ~0.2 s | — |
| one-line edit (HMR) | ~0.5 s | — |

If your numbers are wildly off these, suspect your method before suspecting a regression.

## Config decisions already made (do not silently flip these)

`apps/sim/next.config.ts` pins several `experimental.turbopack*` flags. Two of them look identical and are **opposite decisions**:

- **`turbopackFileSystemCacheForDev: true`** — keep ON. It is what makes a restart cost ~5.6 s instead of ~32 s, and roughly halves RSS. This is also the Next default since v16.1.
- **`turbopackFileSystemCacheForBuild: false`** — keep OFF. Measured harmful for `next build` in this app (PR #6078/#6080: 113 s off vs 360 s warm — 3.2x slower).

Never reason about one from the other, and never change either from a blog post or a default. Both are pinned explicitly so a version bump can't silently flip them.

The dev cache is unbounded on disk — an abandoned one in this repo reached **78 GB across 1,848 SST files**. `scripts/prune-turbopack-cache.ts` runs on `predev` and drops it past a cap (default 20 GB, `SIM_TURBOPACK_CACHE_MAX_GB` to override). Force it with `bun run dev:cache:prune`.

## How to benchmark a dev-performance change

Anything less than this and the number is not trustworthy.

1. **Restart the server between runs.** A second request to an already-compiled route is ~0.2 s and measures nothing.
2. **Stop the server with SIGINT (Ctrl-C), never `kill -9`.** Turbopack persists its FS cache as it works; a hard kill landing mid-write leaves a partial cache that is discarded on next start. This will make a real cache win look like no win at all — it produced a false negative during the original investigation.
3. **n ≥ 3 per arm, and report every run**, not a mean. If the two arms' ranges overlap, you have nothing.
4. **Change exactly one thing.** Config, or code — not both.
5. **Report RSS, not just time.** Memory is the complaint as often as speed. `ps -eo pid,rss,command | grep next-server`.

The canvas route needs a session. Mint one directly rather than clicking through login: insert a row into `session` with a token, and send `Cookie: better-auth.session_token=<token>.<base64 HMAC-SHA256 of token with BETTER_AUTH_SECRET>`. Delete the row afterwards.

For attributing cost *within* a compile, use Next's own profiler rather than guessing:

```bash
NEXT_TURBOPACK_TRACING=1 bun run dev
# then: npx next internal trace .next/dev/trace-turbopack  → https://trace.nextjs.org/
```

## Module-graph bloat

The canvas route's client graph is dominated by the tool registry — see `.agents/skills/tool-registry-boundary/SKILL.md` for the boundary rule and how to measure the graph. In short: `@/tools/registry` is a ~9,000-line barrel of 4,300+ tools whose executable closures pull thousands of modules, and client code must never reach it.

Two general rules that follow:

- **Barrel files cost compile time**, because the compiler must parse them to determine side-effects. Import the specific module when a barrel would drag an unrelated graph. (Local feature barrels for 3+ exports are still the convention — see `.claude/rules/sim-imports.md`. The rule here is about *heavy* barrels, not small ones.)
- **`optimizePackageImports` is not a free win under Turbopack.** Turbopack already analyzes and optimizes imports itself. Adding `lucide-react` to the list was measured at 31.6 s vs a 31.7 s baseline — no effect. Entries here are not inert (they feed `side_effect_free_packages` and force `transpilePackages`), so a speculative entry costs work. Measure before adding one.

## Cheap wins worth checking first

Before any code change, rule these out:

- **Stale `node_modules`.** A lockfile/`node_modules` mismatch surfaces as a confusing `Module not found` 500 on a route, not as "run bun install." Run `bun install` first.
- **Docker for dev on macOS/Windows.** Next's own docs report HMR degrading to seconds or minutes versus running natively. Reserve Docker for production parity.
- **macOS Gatekeeper.** `sudo spctl developer-mode enable-terminal`, then add your terminal under Privacy & Security → Developer Tools.
- **Orphaned dev servers.** Killed runs leave `next-server` processes reparented to `ppid=1` holding memory. `ps -eo pid,ppid,rss,command | grep next-server`.
