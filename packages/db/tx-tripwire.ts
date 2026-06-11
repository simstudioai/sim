import { AsyncLocalStorage } from 'node:async_hooks'
import { createLogger } from '@sim/logger'

const logger = createLogger('DbTxTripwire')

/**
 * Ambient marker set for the duration of a transaction callback on an
 * instrumented pool. Everything awaited or scheduled inside the callback
 * inherits it, at any call depth.
 */
const transactionContext = new AsyncLocalStorage<true>()

type TripwireMode = 'off' | 'warn' | 'throw'

/**
 * Tripwire mode resolution:
 * - `DB_TX_TRIPWIRE=off|warn|throw` overrides everything
 * - otherwise `throw` outside production (bugs fail loudly in dev/CI) and
 *   `warn` in production (rate-limited error log, never breaks traffic)
 */
function resolveMode(): TripwireMode {
  const override = process.env.DB_TX_TRIPWIRE
  if (override === 'off' || override === 'warn' || override === 'throw') return override
  return process.env.NODE_ENV === 'production' ? 'warn' : 'throw'
}

/**
 * True while the current async context is inside a transaction callback on an
 * instrumented pool (any `db.transaction(...)` / `sql.begin(...)`).
 */
export function isInsideDbTransaction(): boolean {
  return transactionContext.getStore() === true
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  )
}

/**
 * Escape hatch: run `fn` outside the ambient transaction context.
 *
 * For DELIBERATE global-pool work initiated inside a transaction callback —
 * e.g. fire-and-forget writes that must not join (or block) the transaction.
 * Promises and timers scheduled inside `fn` also escape the context.
 *
 * Lazy thenables (drizzle query builders) only begin executing when their
 * `.then` is first invoked, so a returned query is assimilated here, inside
 * the exited context — otherwise the caller's `await` would start the query
 * back inside the transaction context and trip the wire.
 */
export function runOutsideTransactionContext<T>(fn: () => T): T {
  return transactionContext.exit(() => {
    const result = fn()
    if (isThenable(result)) {
      return Promise.resolve().then(() => result) as T
    }
    return result
  })
}

const WARN_DEDUPE_WINDOW_MS = 5 * 60 * 1000
const WARN_DEDUPE_MAX_KEYS = 256
const recentWarnings = new Map<string, number>()

function report(poolName: string, query: string): void {
  const mode = resolveMode()
  if (mode === 'off') return

  const queryPreview = query.replace(/\s+/g, ' ').slice(0, 160)
  const message =
    `Query on the global "${poolName}" pool issued inside a transaction callback. ` +
    'The transaction already holds a pooled connection, so this checks out a second one ' +
    'and can deadlock the pool at saturation. Pass the tx handle to the query, hoist the ' +
    'work above the transaction, or wrap deliberate fire-and-forget global-pool work in ' +
    'runOutsideTransactionContext().'

  if (mode === 'throw') {
    throw new Error(`${message} Query: ${queryPreview}`)
  }

  const now = Date.now()
  const lastLogged = recentWarnings.get(queryPreview)
  if (lastLogged !== undefined && now - lastLogged < WARN_DEDUPE_WINDOW_MS) return
  if (recentWarnings.size >= WARN_DEDUPE_MAX_KEYS) {
    for (const [key, loggedAt] of recentWarnings) {
      if (now - loggedAt >= WARN_DEDUPE_WINDOW_MS) recentWarnings.delete(key)
    }
    if (recentWarnings.size >= WARN_DEDUPE_MAX_KEYS) recentWarnings.clear()
  }
  recentWarnings.set(queryPreview, now)
  logger.error(message, { poolName, queryPreview, stack: new Error().stack })
}

/**
 * Minimal structural surface of a postgres-js root client needed by the
 * instrumentation. Method syntax keeps the real `Sql` client assignable and
 * lets tests pass lightweight fakes.
 */
export interface InstrumentablePoolClient {
  unsafe(query: string, ...rest: never[]): unknown
  begin(...args: never[]): unknown
}

interface CallableClient {
  unsafe(...args: unknown[]): unknown
  begin(...args: unknown[]): unknown
}

/**
 * Instrument a postgres-js ROOT client so nested pool checkouts inside
 * transactions are detected at runtime:
 *
 * - `begin(...)` (which `db.transaction(...)` delegates to) runs its callback
 *   inside the ambient transaction context.
 * - `unsafe(...)` — the funnel for every drizzle query issued on the root
 *   client — reports when called while that context is set: the caller is
 *   inside a transaction but querying the global pool instead of the tx
 *   handle.
 * - `begin(...)` itself reports when called inside the context: a nested
 *   `db.transaction(...)` on the global client (savepoints via
 *   `tx.transaction` use the reserved connection and are unaffected).
 *
 * Queries on the reserved connection that `begin` hands to its callback go
 * through that connection's own methods, not the root client's, so
 * transaction-handle queries are exempt by construction.
 */
export function instrumentPoolClient<T extends InstrumentablePoolClient>(
  client: T,
  poolName: string
): T {
  // double-cast-allowed: widens the postgres client's generic method signatures to plain callables so the wrappers can forward arbitrary arguments unchanged
  const target = client as unknown as CallableClient
  const rawUnsafe = target.unsafe.bind(target)
  const rawBegin = target.begin.bind(target)

  target.unsafe = (...args: unknown[]) => {
    if (transactionContext.getStore()) {
      report(poolName, typeof args[0] === 'string' ? args[0] : '(non-string query)')
    }
    return rawUnsafe(...args)
  }

  target.begin = (...args: unknown[]) => {
    if (transactionContext.getStore()) {
      report(poolName, 'BEGIN (nested transaction opened on the global client)')
    }
    const callbackIndex = args.length - 1
    const callback = args[callbackIndex]
    if (typeof callback === 'function') {
      args[callbackIndex] = (...callbackArgs: unknown[]) =>
        transactionContext.run(true, () =>
          (callback as (...inner: unknown[]) => unknown)(...callbackArgs)
        )
    }
    // postgres-js issues its internal BEGIN/COMMIT statements through the
    // root client's `unsafe`; running `begin` outside the ambient context
    // keeps those from re-reporting a nested transaction the wrapper above
    // already reported. The callback wrapper re-enters the context itself.
    return transactionContext.exit(() => rawBegin(...args))
  }

  return client
}
