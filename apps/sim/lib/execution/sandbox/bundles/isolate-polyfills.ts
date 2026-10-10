/**
 * Minimal isolate-side shim run at the top of every bundle entry.
 *
 * Must execute BEFORE `process/browser` because that shim captures
 * `setTimeout` at module-init time. Timers themselves are installed by
 * `isolated-vm-worker.cjs` (delegated to Node's real timers via
 * `ivm.Reference` per laverdet/isolated-vm#136) BEFORE the bundle runs, so
 * `process/browser` picks up the real delegated `setTimeout`.
 *
 * Beyond aliasing `global -> globalThis` for UMD-style fallbacks inside the
 * bundles, this file only answers the one name the bundler can leave dangling
 * (see below). All other runtime surface (`console`, `TextEncoder`,
 * `TextDecoder`, timers) is installed by the worker via `ivm.Callback` /
 * `ivm.Reference` bridges to Node's native implementations — no hand-rolled
 * polyfill logic lives in the isolate.
 */

const g: typeof globalThis & {
  global?: typeof globalThis
  __require?: (id: string) => never
} = globalThis

if (typeof g.global === 'undefined') g.global = globalThis

/**
 * A library that inlines a CommonJS dependency ships esbuild's `__require`
 * helper around it (docx >= 9.7.1 does this for JSZip's UMD build). Bun's
 * browser/iife build rewrites the bare `require` references inside that helper
 * to its own `__require` runtime helper and then never emits it, so the bundle
 * throws `ReferenceError: __require is not defined` while it is still being
 * evaluated. The isolate has no `require` at all, so the only correct answer
 * to a dynamic require is the one esbuild's helper gives when `require` is
 * absent: throw. Defining it here keeps every bundle self-contained; `build.ts`
 * evaluates each bundle in a bare context so a new variant of the defect fails
 * the build instead of shipping.
 */
if (typeof g.__require === 'undefined') {
  g.__require = (id: string): never => {
    throw new Error(`Dynamic require of "${id}" is not supported in the sandbox`)
  }
}

export {}
