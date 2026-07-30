# Experiment: is the Turbopack FS build cache a net win?

**Do not merge.** This branch exists to produce three measurements and then be closed.

## Question

`NEXT_TURBOPACK_BUILD_CACHE=1` was added in #5869 on the premise that a warm Turbopack
filesystem cache makes `next build` faster. Observational data from 2026-07-29 suggests the
opposite:

| cache state | pre-build disk | compile |
|---|---|---|
| genuinely cold, FS cache on | 4.0K | **1.8 min** |
| perfect-warm, FS cache on (written 50s earlier) | 5.1G | **4.0 min** |
| mismatched-warm, FS cache on (old event-only key) | — | **11.3 min** |
| FS cache absent entirely (13 runs before #5869) | n/a | **2.2–3.6 min, median 2.7** |

Cold < perfect-warm < mismatched-warm. If that ordering is real, the cache is costing wall
time and the correct action is to turn it off.

All four rows are observational, from runs that differed in commit as well as cache state.
This branch holds the tree constant and varies only the cache.

## Method

Three sequential runs on this one branch. Each commit touches **only** `.github/**` +
this file, so the Next module graph is byte-identical across all three — cache-match
quality is held constant and only cache *state* varies.

| run | commit | `NEXT_TURBOPACK_BUILD_CACHE` | expected disk state |
|---|---|---|---|
| A | first push | `'1'` | **cold** (brand-new per-branch sticky key) |
| B | trivial edit | `'1'` | **warm**, written by A, identical module graph |
| C | flip the env | `'0'` | irrelevant — Turbopack ignores the on-disk cache |

Read from each Build App log: `Report Next.js cache size (pre-build)`,
`Compiled successfully in X`, `Report Next.js cache size (post-build)`.

## Two traps this design defuses

1. **Turbo task-cache replay.** A `.github`-only commit leaves Turbo's task inputs
   unchanged, so Turbo would replay a cached log and reprint a *stale* compile time from an
   unrelated run — fabricating the number being measured. `--force` makes every run a real
   build. Five such phantom runs had to be discarded from the observational data.
2. **Cancelled-run confusion.** `ci.yml` sets `cancel-in-progress` for pull_request events,
   so pushing before a run finishes cancels it — and a cancelled run still writes its
   partial cache to the sticky disk. A prior conclusion ("a brand-new sticky key is not
   cold") was wrong for exactly this reason: the "first" run had a cancelled sibling 3
   minutes earlier that had already committed 5.1 GB. **Each run here must reach
   `completed` before the next push.**

## Result

Filled in as runs land.

| run | pre-build | compile | post-build | job total | run id |
|---|---|---|---|---|---|
| A — cold, cache on | **4.0K** | **2.7 min** | 5.1G | 3m54s | 30504331243 |
| B — warm, cache on | | | | | |
| C — cache off | | | | | |

Run A notes: single CI run on the branch, no cancelled sibling, `--force` confirmed in the
log so this was a real build and not a Turbo replay. 4.0K pre-build settles a separate
question — a brand-new sticky-disk key is **cold**; Blacksmith does not hydrate it. 2.7 min
also lands exactly on the pre-#5869 no-FS-cache median (2.7 min), which is the first hint
that the cache buys nothing on a cold run.
