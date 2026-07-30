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
| B — warm, cache on | **5.1G** | **6.0 min** | **12G** | 8m18s | 30504621611 |
| C — cache off | 5.1G (ignored) | **113s = 1.9 min** | 5.1G | **2m53s** | 30505173423 |

Run A notes: single CI run on the branch, no cancelled sibling, `--force` confirmed in the
log so this was a real build and not a Turbo replay. 4.0K pre-build settles a separate
question — a brand-new sticky-disk key is **cold**; Blacksmith does not hydrate it. 2.7 min
also lands exactly on the pre-#5869 no-FS-cache median (2.7 min), which is the first hint
that the cache buys nothing on a cold run.

Run B notes: pre-build 5.1G written by run A, module graph byte-identical, `--force` again
confirmed. Compile **2.2x slower than cold** (6.0 vs 2.7 min); job 8m18s vs 3m54s. The cache
also **grew 5.1G -> 12G on an identical tree**, which is the likely mechanism behind the
progressive degradation seen on older shared disks (up to 11.7 min): the more a disk is
written, the more there is to read and revalidate. Run B's CI run shows `failure`, but Build
App passed - the failing job was `Lint and Test` on a 1ms real-clock flake in
`pi-lifetime.test.ts` (`expected 5399999 to be 5400000`), unrelated to this experiment.

Run C notes: flag manipulation verified in the log — run A prints
`✓ turbopackFileSystemCacheForBuild`, run C omits it entirely. Fastest of the three:
**3.2x faster than warm** (113s vs 360s) and still 1.4x faster than cold-with-cache, because
it neither reads nor writes the 5.1G.

## Conclusion

The Turbopack FS build cache is a net negative for this app at its current size. Ranked:

| config | compile | Build App job |
|---|---|---|
| cache OFF | **113s** | **2m53s** |
| cache ON, cold | 162s | 3m54s |
| cache ON, warm | 360s | 8m18s |

Recommendation: disable `NEXT_TURBOPACK_BUILD_CACHE`. #5869 enabled it on locally-measured
numbers (105s cold -> 22s warm) that never reproduced in CI and are inverted here.

Caveat: n=1 per cell. The effect size (3.2x) and agreement with ~15 prior observations make
it convincing, but this is three runs, not a distribution.

One unexplained anomaly: run B committed 12G, yet run C mounted 5.1G. Does not affect the
conclusion (C ignores the disk either way), but it means sticky-disk commit semantics are not
fully understood — do not build anything on assumptions about them.
