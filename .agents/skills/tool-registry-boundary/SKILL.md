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
| whether a tool id exists | `hasToolId` from `@/tools/tool-ids` | ~110 KB — the cheapest module |
| to resolve an unversioned name | `resolveToolId` from `@/tools/tool-ids` | |
| every tool id | `getToolIds` from `@/tools/tool-ids` | |
| a tool's params | `getToolParams` / `getToolMetadata` from `@/tools/metadata` | ~4 MB |
| a tool's declared outputs | `getToolOutputsMetadata` from `@/tools/metadata-outputs` | ~4 MB, separate on purpose |
| to **execute** a tool | `getTool` from `@/tools/utils`, or `@/tools/utils.server` | server paths only |

Three modules, cheapest first. Ids are their own artifact because resolution and existence checks need only the key set; outputs are their own because they are the larger half of the data with a single consumer. `@/tools/metadata` and `@/tools/metadata-outputs` both resolve ids through `@/tools/tool-ids`, which is what keeps them independent of each other — do not "helpfully" re-export one from another, or every caller pays for all three.

All lookups guard with `Object.hasOwn`. `JSON.parse` yields an object with the normal prototype, so a bare bracket lookup returns inherited members: `getToolMetadata('constructor')` returned a *function* typed as tool metadata before that was fixed.

## The generated artifacts

`apps/sim/tools/generated/tool-ids.ts`, `tool-metadata.ts` and `tool-outputs.ts` are produced by `scripts/sync-tool-metadata.ts`:

```bash
bun run tool-metadata:generate   # after adding/changing a tool
bun run tool-metadata:check      # what CI runs; fails if stale
```

Never hand-edit them. If you add a tool or change a tool's `params`/`outputs`, regenerate and commit the result, or CI fails.

Three non-obvious properties, each of which was measured and is easy to undo by accident:

- **The data is a JSON string parsed at runtime, not an imported `.json` and not an object literal.** With `resolveJsonModule` (which this repo enables), a `.json` import makes TypeScript infer a literal type for all 4,300+ entries and takes `tsc --noEmit` from **12.6s to 8m07s** — a 38x regression. An ambient `declare module` does *not* short-circuit it, and an object literal costs the same. A single string literal is one cheap token for both the compiler and the bundler, and `JSON.parse` beats evaluating the equivalent literal at runtime. Do not "clean this up" into a `.json` import.
- **The generator refuses to emit function values.** If you add a field to `METADATA_FIELDS` that contains a closure, generation fails loudly rather than shipping executable config to the client. `hosting` and `schemaEnrichment` are excluded for exactly this reason (`hosting.enabled`, `pricing`, and `enrichSchema` are functions) — they are server-only.
- **Empty param entries are stripped.** The registry contains one (`stt_deepgram_v2`), which crashes callers that read `param.type` while iterating.
- **Lookups resolve versions.** `getTool` maps an unversioned name onto the newest version, and 246 tools are versioned. A plain key lookup would silently report them missing — a quiet correctness bug, not a crash. `resolveToolId` reproduces that against the id set and is differentially tested against the original.

## Testing code that reads tool metadata

Mock the module the code under test actually reads. `vi.mock('@/tools/utils', () => toolsUtilsMock)` only controls `getTool`; code that reads `params`/`outputs`/`name` goes through `@/tools/metadata`, so mocking `tools/utils` there is a **no-op that still passes** — because the real generated artifacts happen to agree with the mock fixtures. The test looks green while controlling nothing.

```ts
import { blocksMock, toolsMetadataMock, toolsUtilsMock } from '@sim/testing/mocks'

vi.mock('@/tools/utils', () => toolsUtilsMock)      // executable lookup
vi.mock('@/tools/metadata', () => toolsMetadataMock) // params / outputs / name
```

Both are backed by the same `mockToolConfigs`, so mocking both gives one consistent tool universe. If you are unsure whether a mock is load-bearing, change a fixture value to a sentinel and confirm the test fails.
## The guard

`bun run check:tool-registry-boundary` (CI: "Tool registry client-boundary audit") walks the module graph from each workspace route and fails if `@/tools/registry` is reachable, printing the exact import chain that reintroduced it.

If it fails, do not add the entry to an allowlist — there isn't one. Find the symbol the offending file actually needs and move it to a registry-free module, exactly as `mergeToolParameters` and `formatParameterLabel` were.

Run it with `--verbose` to print per-route module counts, which is also the quickest way to see whether a change moved the graph.

The same command also ratchets those counts against `check-tool-registry-boundary.baseline.json`. `--check` (what CI runs) fails when an entry exceeds its baseline by more than `max(25 modules, 2%)`, naming the import chain responsible. This catches bloat the registry rule misses — a prefetch importing `listTables` cost the Tables page 444 modules without ever touching `@/tools/registry`.

Re-record with `--update-baseline` and commit the JSON when growth is deliberate. A *shrink* passes but is reported — re-record then too, or the win is silently spendable again.

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
| `app/workspace/[workspaceId]/w/page.tsx` (canvas) | 6,592 before, 1,908 after |

The canvas route reached the registry through **four** redundant edges — `providers/utils` (via `tools/params`), `lib/workflows/blocks/block-outputs`, `lib/workflows/sanitization/validation`, and `serializer/index`. Cutting any one alone moved the module count by ~1. They all had to go before anything improved; measure the route, not the file you edited.

## When adding a new caller

Ask what the caller does with the config. If it reads `params`, `outputs`, `name`, `description` or just checks existence, it belongs on `@/tools/metadata` — no exceptions, even on a path you believe is server-only today, because a future client import will silently re-attach the registry to the graph.

If it genuinely executes — builds a request, transforms a response, runs `directExecution` — use `getTool`, and keep that file off client-reachable paths.
