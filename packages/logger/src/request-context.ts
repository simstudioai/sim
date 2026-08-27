export interface RequestContext {
  requestId: string
  method?: string
  path?: string
  /**
   * The 32-hex OTel trace id correlating this request across services
   * (the same value the Go copilot logs as trace_id/request_id). Seeded
   * from an incoming `traceparent` header, or stamped mid-request via
   * `setRequestTraceId` when the trace root is created locally.
   */
  traceId?: string
}

/**
 * AsyncLocalStorage is only available in Node.js. In Edge/browser contexts
 * we fall back to a no-op implementation so the logger import doesn't break.
 */
interface Storage<T> {
  getStore(): T | undefined
  run<R>(store: T, fn: () => R): R
}

let storage: Storage<RequestContext>

if (typeof globalThis.process !== 'undefined' && globalThis.process.versions?.node) {
  // Node.js — use real AsyncLocalStorage
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AsyncLocalStorage } = require('node:async_hooks') as typeof import('node:async_hooks')
  storage = new AsyncLocalStorage<RequestContext>()
} else {
  // Edge / browser — no-op
  storage = {
    getStore: () => undefined,
    run: <R>(_store: RequestContext, fn: () => R) => fn(),
  }
}

/**
 * Runs a callback within a request context. All loggers called inside
 * the callback (and any async functions it awaits) will automatically
 * include the request context metadata in their output.
 */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn)
}

/**
 * Returns the current request context, or undefined if called outside
 * of a `runWithRequestContext` scope.
 */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore()
}

/**
 * Stamps the cross-service trace id onto the current request context so
 * every subsequent log line in this request carries it. The trace root is
 * often created after the route context (e.g. the copilot chat POST derives
 * its trace id when it starts the OTel root), so this mutates the live
 * store rather than requiring the id at `runWithRequestContext` time.
 * No-op outside a request context.
 */
export function setRequestTraceId(traceId: string): void {
  const store = storage.getStore()
  if (store && traceId) store.traceId = traceId
}
