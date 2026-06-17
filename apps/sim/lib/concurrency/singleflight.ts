const inflight = new Map<string, Promise<unknown>>()

/**
 * Default deadline for a coalesced producer to settle. Joiners share the
 * producer's promise, so without a deadline a single hung producer wedges
 * every future caller for that key until process restart.
 */
const DEFAULT_SETTLE_TIMEOUT_MS = 30_000

/**
 * Thrown to all awaiters when a coalesced producer fails to settle within
 * its deadline. The entry is evicted first, so the next caller mints a
 * fresh producer instead of joining the wedged one.
 */
export class CoalesceSettleTimeoutError extends Error {
  constructor(key: string, timeoutMs: number) {
    super(`Coalesced producer for "${key}" did not settle within ${timeoutMs}ms`)
    this.name = 'CoalesceSettleTimeoutError'
  }
}

/**
 * Deduplicates concurrent async work by key within this process: the first
 * caller runs `fn`, every concurrent caller for the same key shares its
 * promise. The entry is evicted when the producer settles (either way) or
 * when the settle deadline fires, whichever comes first. The underlying
 * `fn` is not cancelled on timeout — it keeps running detached, but no new
 * caller will join it.
 */
export function coalesceLocally<T>(
  key: string,
  fn: () => Promise<T>,
  settleTimeoutMs: number = DEFAULT_SETTLE_TIMEOUT_MS
): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) return existing

  let timer: ReturnType<typeof setTimeout> | undefined
  const evict = () => {
    if (inflight.get(key) === guarded) inflight.delete(key)
  }

  const guarded: Promise<T> = Promise.race([
    (async () => {
      try {
        // Defer fn() to a microtask so a synchronous throw surfaces as a
        // rejection after `guarded` and the timer are initialized. Calling it
        // inline would run the finally below during construction, touching
        // `guarded` in its temporal dead zone and masking fn's real error.
        return await Promise.resolve().then(fn)
      } finally {
        clearTimeout(timer)
        evict()
      }
    })(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        evict()
        reject(new CoalesceSettleTimeoutError(key, settleTimeoutMs))
      }, settleTimeoutMs)
      timer.unref?.()
    }),
  ])

  inflight.set(key, guarded)
  return guarded
}

export function __resetCoalesceLocallyForTests(): void {
  inflight.clear()
}
