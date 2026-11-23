/**
 * Calls a registry thunk (a function-form condition, `required`, `options`, `value()` or
 * `tools.config.tool`) against a value bag that records which keys the thunk reads.
 *
 * The catalog is data, so every thunk is either evaluated here or marked opaque. What decides it
 * is the read set: a thunk that reads no block value depends only on the deployment (the agent's
 * temperature gates read the model registry), so its result is the same for every workflow and is
 * evaluated once. A thunk that reads values is opaque, and when it reads nothing but `operation`
 * it can still be expanded per operation, which is the visibility pre-expansion the SDK codegen
 * needs.
 */

type ProbeOutcome<T> =
  | { ok: true; result: T; reads: ReadonlySet<string> }
  | { ok: false; reads: ReadonlySet<string> }

/**
 * Builds a frozen-looking value bag whose reads are recorded: a value read, an `in` check, and an
 * own-key check (`Object.hasOwn`, `hasOwnProperty.call`) each record the key. Symbol reads (`Symbol.toPrimitive`,
 * iterator probes from spreading) are answered from the target and never recorded.
 */
function recordingValues(
  values: Record<string, unknown>,
  reads: Set<string>
): Record<string, unknown> {
  return new Proxy(values, {
    get(target, key) {
      if (typeof key === 'string') reads.add(key)
      return Reflect.get(target, key)
    },
    has(target, key) {
      if (typeof key === 'string') reads.add(key)
      return Reflect.has(target, key)
    },
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === 'string') reads.add(key)
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
    ownKeys(target) {
      reads.add('*')
      return Reflect.ownKeys(target)
    },
  })
}

/**
 * Runs `thunk` with recorded `values`. A throw is an outcome, not an error: a thunk that
 * dereferences a value it was not given cannot be evaluated without that value, which is exactly
 * what "opaque" means. `'*'` in the read set means the thunk enumerated the bag.
 */
export function probeThunk<T>(
  thunk: (values: Record<string, unknown>) => T,
  values: Record<string, unknown> = {}
): ProbeOutcome<T> {
  const reads = new Set<string>()
  try {
    const result = thunk(recordingValues({ ...values }, reads))
    return { ok: true, result, reads }
  } catch {
    return { ok: false, reads }
  }
}

/** Whether a probe read nothing but the keys in `allowed`. */
export function readsOnly(reads: ReadonlySet<string>, allowed: ReadonlySet<string>): boolean {
  for (const key of reads) {
    if (!allowed.has(key)) return false
  }
  return true
}
