import vm from 'node:vm'
import type { SandboxBundleName } from '@/lib/execution/sandbox/types'

/** Verifies the Function bundle without lending it any host globals. */
export function evaluateFunctionGlobals(source: string): vm.Context {
  const context = vm.createContext({})
  vm.runInContext(source, context, { filename: 'function-globals.cjs', timeout: 5000 })
  for (const name of ['Buffer', 'TextEncoder', 'TextDecoder', 'atob', 'btoa']) {
    if (typeof context[name] !== 'function') {
      throw new Error(`Function bundle did not provide ${name}`)
    }
  }
  for (const name of ['process', 'require', 'fetch', 'setTimeout']) {
    if (context[name] !== undefined) {
      throw new Error(`Function bundle unexpectedly exposed ${name}`)
    }
  }
  return context
}

/**
 * Evaluates a built sandbox bundle the way the isolated-vm worker will: as a
 * classic script in a context that has timers, `console`, and the text codecs
 * but no `require`, `process`, or `Buffer` of its own. Returns the export the
 * bundle registered on `globalThis.__bundles`, or throws with the bundle's own
 * error, so a bundle that references a helper the bundler never emitted fails
 * at build time and in the test suite instead of on the first document
 * generated in production.
 */
export function evaluateSandboxBundle(source: string, name: SandboxBundleName): unknown {
  const context: Record<string, unknown> = {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    console,
    TextEncoder,
    TextDecoder,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(source, context, { filename: `sandbox/${name}.cjs` })

  const bundles = context.__bundles
  const bundle =
    typeof bundles === 'object' && bundles !== null
      ? (bundles as Record<string, unknown>)[name]
      : undefined
  if (bundle === undefined || bundle === null) {
    throw new Error(
      `Sandbox bundle "${name}" evaluated without registering globalThis.__bundles["${name}"]`
    )
  }
  return bundle
}
