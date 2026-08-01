---
name: tool-registry-boundary
description: Keep the executable tool registry out of client-reachable module graphs — when to read `@/tools/metadata` instead of `getTool`, how to measure whether an import edge pulls the registry, and how to regenerate the metadata artifacts. Use when touching `apps/sim/tools/registry.ts`, `tools/utils.ts`, `tools/params.ts`, or anything that calls `getTool`.
---

# Tool Registry Boundary Skill

You keep the 4,300-tool executable registry out of module graphs that don't execute tools.

## The rule

> Client-reachable code reads tool **metadata**. Only code that actually executes a tool imports the **registry**.

`@/tools/registry` is a ~9,000-line barrel importing every tool. Each `ToolConfig` mixes plain data (`params`, `outputs`, `name`) with closures — `request.url`, `request.headers`, `transformResponse`, `directExecution`, `postProcess`. Those closures reach the SDK clients, API helpers and parsers each integration needs, and that is what makes the barrel expensive: reaching it costs ~4,700 additional modules.

`getTool()` returns the whole `ToolConfig`, so a single `getTool` import anywhere in a client-reachable file drags all of it in.

## Which module to import

| you need | import | notes |
| --- | --- | --- |
| whether a tool id exists | `hasToolMetadata` from `@/tools/metadata` | |
| a tool's params | `getToolParams` / `getToolMetadata` from `@/tools/metadata` | |
| a tool's declared outputs | `getToolOutputsMetadata` from `@/tools/metadata-outputs` | separate module on purpose — see below |
| every tool id | `getToolIds` from `@/tools/metadata` | |
| to **execute** a tool | `getTool` from `@/tools/utils`, or `@/tools/utils.server` | server paths only |

Outputs live in their own module because they are roughly two thirds of the generated data and have a single consumer. Importing `@/tools/metadata` must never pull them — do not "helpfully" re-export one from the other.

## The generated artifacts

`apps/sim/tools/generated/tool-metadata.ts` and `tool-outputs.ts` are produced by `scripts/sync-tool-metadata.ts`:

```bash
bun run tool-metadata:generate   # after adding/changing a tool
bun run tool-metadata:check      # what CI runs; fails if stale
```

Never hand-edit them. If you add a tool or change a tool's `params`/`outputs`, regenerate and commit the result, or CI fails.

Three non-obvious properties, each of which was measured and is easy to undo by accident:

- **The data is a JSON string parsed at runtime, not an imported `.json` and not an object literal.** With `resolveJsonModule` (which this repo enables), a `.json` import makes TypeScript infer a literal type for all 4,300+ entries and takes `tsc --noEmit` from **12.6s to 8m07s** — a 38x regression. An ambient `declare module` does *not* short-circuit it, and an object literal costs the same. A single string literal is one cheap token for both the compiler and the bundler, and `JSON.parse` beats evaluating the equivalent literal at runtime. Do not "clean this up" into a `.json` import.
- **The generator refuses to emit function values.** If you add a field to `METADATA_FIELDS` that contains a closure, generation fails loudly rather than shipping executable config to the client. `hosting` and `schemaEnrichment` are excluded for exactly this reason (`hosting.enabled`, `pricing`, and `enrichSchema` are functions) — they are server-only.
- **Empty param entries are stripped.** The registry contains one (`stt_deepgram_v2`), which crashes callers that read `param.type` while iterating.

## How to verify an edge actually got cut

Do not eyeball imports — the registry is reached through several redundant paths, so cutting one buys nothing while another survives. Walk the graph:

1. From the entry you care about, follow `import` and `export … from` (skipping `import type`), resolving `@/` against `apps/sim`.
2. Check whether `apps/sim/tools/registry.ts` is in the reachable set, and print the parent chain if it is.
3. Compare the reachable module count before and after.

Reference points measured on this repo:

| entry | modules |
| --- | --- |
| `tools/registry.ts` reachable | ~4,900 |
| `tools/merge-params.ts` (leaf) | 2 |
| `providers/utils.ts` after cutting its `params` edge | 22 |
| `app/workspace/[workspaceId]/w/page.tsx` (canvas) | 6,591, of which 4,689 are the registry |

The canvas route reaches the registry through **four** redundant edges — `providers/utils` (via `tools/params`), `lib/workflows/blocks/block-outputs`, `lib/workflows/sanitization/validation`, and `serializer/index`. Cutting any one alone moves the module count by ~1. They must all be cut before anything improves; measure the route, not the file you edited.

## When adding a new caller

Ask what the caller does with the config. If it reads `params`, `outputs`, `name`, `description` or just checks existence, it belongs on `@/tools/metadata` — no exceptions, even on a path you believe is server-only today, because a future client import will silently re-attach the registry to the graph.

If it genuinely executes — builds a request, transforms a response, runs `directExecution` — use `getTool`, and keep that file off client-reachable paths.
