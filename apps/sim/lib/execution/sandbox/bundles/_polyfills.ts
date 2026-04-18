/**
 * Minimal isolate-side shim run at the top of every bundle entry.
 *
 * Must execute BEFORE `process/browser` because that shim captures
 * `setTimeout` at module-init time. Timers themselves are installed by
 * `isolated-vm-worker.cjs` (delegated to Node's real timers via
 * `ivm.Reference` per laverdet/isolated-vm#136) BEFORE the bundle runs, so
 * `process/browser` picks up the real delegated `setTimeout`.
 *
 * The only thing this file still does is alias `global -> globalThis` for
 * UMD-style fallbacks inside the bundles. All other runtime surface
 * (`console`, `TextEncoder`, `TextDecoder`, timers) is installed by the
 * worker via `ivm.Callback` / `ivm.Reference` bridges to Node's native
 * implementations — no hand-rolled polyfill logic lives in the isolate.
 */

const g = globalThis as unknown as Record<string, unknown>

if (typeof g.global === 'undefined') g.global = globalThis

export {}
