import type { BaseResource } from '@sim/workspace-code'
import type { StoredResource } from '@/lib/workspace-source/application/types'

/**
 * The three-way rule every kind decides a declared resource with, from its fingerprint in the
 * directory (`local`), in the base the directory was read at (`base`) and on the server now
 * (`server`):
 *
 * | local vs base | server vs base | outcome |
 * |---|---|---|
 * | equal | any | `noop`, `serverChanged` when the server drifted |
 * | differs | equal | `apply` |
 * | differs | differs | `noop` when local equals server, else `stale` |
 */
export type ThreeWayOutcome =
  | { action: 'noop'; serverChanged: boolean }
  | { action: 'apply' }
  | { action: 'stale' }

export function decide(local: string, base: string, server: string): ThreeWayOutcome {
  if (local === base) return { action: 'noop', serverChanged: server !== base }
  if (server === base) return { action: 'apply' }
  return local === server ? { action: 'noop', serverChanged: true } : { action: 'stale' }
}

/** How a declared resource resolves against the server and the base, before kind-specific diffing. */
export type DeclaredResolution<S> =
  | { action: 'create' }
  | { action: 'adopt'; stored: StoredResource<S> }
  | { action: 'update'; stored: StoredResource<S>; base: BaseResource; serverFingerprint: string }
  | {
      action: 'noop'
      stored: StoredResource<S>
      serverChanged: boolean
      /** Set when the directory's base lacked this entry: the base the no-op records. */
      refreshed?: boolean
    }
  | { action: 'stale'; stored: StoredResource<S> }
  | { action: 'no-base'; stored: StoredResource<S> }

/**
 * Resolves one declared resource. With a base entry for the stored resource the three-way rule
 * decides; without one, a stored resource the source matches exactly is a no-op that records the
 * base (an earlier apply created it but never wrote its base back), and any other is
 * `no-base` (get it first). With nothing stored under the key, an unbound resource of the same
 * name is adopted, else the resource is created (re-claiming a key a deleted resource held).
 */
export function resolveDeclared<S>(input: {
  local: string
  stored?: StoredResource<S>
  adoptable?: StoredResource<S>
  base?: BaseResource
  fingerprint: (stored: StoredResource<S>, base?: BaseResource) => string
}): DeclaredResolution<S> {
  const { stored, base } = input
  if (!stored)
    return input.adoptable ? { action: 'adopt', stored: input.adoptable } : { action: 'create' }
  if (base && base.id === stored.id && base.fingerprint) {
    const server = input.fingerprint(stored, base)
    const outcome = decide(input.local, base.fingerprint, server)
    if (outcome.action === 'apply') {
      return { action: 'update', stored, base, serverFingerprint: server }
    }
    if (outcome.action === 'stale') return { action: 'stale', stored }
    return { action: 'noop', stored, serverChanged: outcome.serverChanged }
  }
  return input.local === input.fingerprint(stored)
    ? { action: 'noop', stored, serverChanged: false, refreshed: true }
    : { action: 'no-base', stored }
}
