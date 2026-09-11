import type { ResolvedClientInfo } from '@sim/utils/client-info'

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
  /**
   * Which official client sent the request (web, desktop, CLI, an SDK), when
   * it could be established. Resolved once by the route handler so logs and
   * analytics emitted anywhere in the request attribute it without each call
   * site re-reading headers.
   */
  client?: ResolvedClientInfo
  /**
   * How the request authenticated, stamped by the surface adapter once its
   * credential resolved to a principal. Absent on public and unauthenticated
   * requests, and until authentication has run.
   */
  auth?: RequestAuth
  /**
   * The workflow-to-workflow call chain the request arrived with (`X-Sim-Via`),
   * oldest first. Present only when one workflow's execution made this call.
   */
  callChain?: readonly string[]
}

/**
 * The credential kind a request authenticated with, in the vocabulary of the
 * principal it produced: `session`, `personal_api_key`, `workspace_api_key`,
 * `oauth_access_token`, `delegated`, `system`, and so on. `service` names the
 * delegating or system service (`copilot`, `schedule`, …) and `clientId` the
 * OAuth client (`sim-cli`), when the kind carries one.
 */
export interface RequestAuth {
  kind: string
  service?: string
  clientId?: string
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

/**
 * Records how the current request authenticated so every later log line and
 * analytics event in it can say so. Authentication runs inside the handler,
 * after the route context exists, hence a mutation of the live store rather
 * than a field supplied at `runWithRequestContext` time. No-op outside a
 * request context.
 */
export function setRequestAuth(auth: RequestAuth): void {
  const store = storage.getStore()
  if (store) store.auth = auth
}
