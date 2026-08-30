import { cache } from 'react'
import type { PermissionGroupConfig } from '@/lib/permission-groups/fields'
import {
  getUserPermissionConfig,
  resolveVerifiedUserAccessControlContext,
} from '@/lib/permission-groups/resolve.server'

type ConfigKey = `${string}:${string}`
type ConfigStore = Map<ConfigKey, Promise<PermissionGroupConfig | null>>

interface Storage<T> {
  getStore(): T | undefined
  run<R>(store: T, fn: () => R): R
}

let storage: Storage<ConfigStore>

if (typeof globalThis.process !== 'undefined' && globalThis.process.versions?.node) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AsyncLocalStorage } = require('node:async_hooks') as typeof import('node:async_hooks')
  storage = new AsyncLocalStorage<ConfigStore>()
} else {
  storage = {
    getStore: () => undefined,
    run: <R>(_store: ConfigStore, fn: () => R) => fn(),
  }
}

/**
 * Establishes one permission-group memo for everything a request or job does.
 *
 * A request that authorizes several operations — a bulk mutation, a route that
 * runs two use cases — would otherwise resolve the same group once per
 * operation. Nesting this inside the request context means every route handler
 * gets it without threading a parameter through 266 operations.
 */
export function withPermissionGroupScope<R>(run: () => R): R {
  return storage.run(new Map(), run)
}

/**
 * Memoized for a React server request, so an RSC render that resolves the same
 * viewer twice still makes one query. Both paths delegate here, so the scope and
 * the React cache can never disagree.
 */
const resolveCached = cache(
  async (
    userId: string,
    workspaceId: string,
    organizationId: string | null | undefined
  ): Promise<PermissionGroupConfig | null> =>
    organizationId === undefined
      ? await getUserPermissionConfig(userId, workspaceId)
      : (await resolveVerifiedUserAccessControlContext(userId, workspaceId, organizationId)).config
)

/**
 * The permission-group config governing `userId` in `workspaceId`, resolved at
 * most once per scope.
 *
 * Caches the promise rather than the value, so concurrent callers share one
 * query instead of racing to start several. Caches `null` too — "no group
 * governs this user" is the common answer and the one least worth re-asking.
 *
 * Outside a scope this degrades to the React memo, and outside a request to a
 * direct call: slower, never wrong.
 *
 * Pass `undefined` for `organizationId` when the caller has not already loaded
 * the workspace — a raw route, typically. The resolver looks it up, and both
 * forms share this memo, so a request that mixes them still queries once.
 *
 * `organizationId` is deliberately NOT part of the key, and adding it would
 * split the cache and double the queries for no gain. Both arms end in
 * `resolveUserAccessControlContextForOrganization(userId, workspaceId, org)`;
 * they differ only in where `org` came from, and a caller may only pass the
 * organization of the very workspace it names — it is a value it loaded off
 * that workspace, not an independent argument. So `organizationId` is a
 * function of `workspaceId`, and the key already carries it. A caller that
 * passed some *other* organization would be resolving the wrong group with or
 * without this memo, and would fail open (no group in that organization targets
 * this workspace, so nothing restricts); that is a call-site invariant, which
 * is why the parameter is documented as "already loaded" rather than free.
 */
export function resolvePermissionGroupConfig(
  userId: string,
  workspaceId: string,
  organizationId: string | null | undefined
): Promise<PermissionGroupConfig | null> {
  const store = storage.getStore()
  if (!store) return resolveCached(userId, workspaceId, organizationId)

  const key: ConfigKey = `${userId}:${workspaceId}`
  const existing = store.get(key)
  if (existing) return existing

  const pending = resolveCached(userId, workspaceId, organizationId)
  store.set(key, pending)
  return pending
}
