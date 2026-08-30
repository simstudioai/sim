import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'

/**
 * A resolution key, `userId:workspaceId`. `organizationId` is deliberately not
 * part of it — see `resolvePermissionGroupConfig` for why.
 */
export type PermissionGroupConfigKey = `${string}:${string}`

/**
 * The per-scope memo: a resolution key to the in-flight resolution for it.
 *
 * Holds the promise rather than the resolved value so N concurrent
 * authorizations share one query instead of racing to start several.
 */
export type PermissionGroupConfigStore = Map<
  PermissionGroupConfigKey,
  Promise<PermissionGroupConfig | null>
>

interface Storage<T> {
  getStore(): T | undefined
  run<R>(store: T, fn: () => R): R
}

/**
 * AsyncLocalStorage is only available in Node.js. Parts of this graph reach the
 * Edge runtime, so fall back to a no-op that simply runs the callback — the
 * resolver then degrades to its React `cache()` memo, which is slower but never
 * wrong.
 */
let storage: Storage<PermissionGroupConfigStore>

if (typeof globalThis.process !== 'undefined' && globalThis.process.versions?.node) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AsyncLocalStorage } = require('node:async_hooks') as typeof import('node:async_hooks')
  storage = new AsyncLocalStorage<PermissionGroupConfigStore>()
} else {
  storage = {
    getStore: () => undefined,
    run: <R>(_store: PermissionGroupConfigStore, fn: () => R) => fn(),
  }
}

/**
 * Establishes one permission-group memo for everything a request or job does.
 *
 * A request that authorizes several operations — a bulk mutation, a route that
 * runs two use cases — would otherwise resolve the same group once per
 * operation. Nesting this inside the request context means every route handler
 * gets it without threading a parameter through 266 operations.
 *
 * This module is deliberately free of runtime imports. `withRouteHandler` wraps
 * every route in the app, so anything reachable from here is loaded by every
 * route and every route test; the resolver that fills the store lives in
 * `config-scope.server.ts`, which only the gate call sites import.
 */
export function withPermissionGroupScope<R>(run: () => R): R {
  return storage.run(new Map(), run)
}

/** The memo for the current scope, or undefined when running outside one. */
export function getPermissionGroupConfigStore(): PermissionGroupConfigStore | undefined {
  return storage.getStore()
}
