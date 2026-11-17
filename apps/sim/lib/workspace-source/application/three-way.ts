import type { BaseResource } from '@sim/workspace-code'
import {
  noBaseFinding,
  serverChangedFinding,
  serverGoneFinding,
  staleFinding,
} from '@/lib/workspace-source/application/findings'
import type {
  PlannedChange,
  StoredResource,
  StoredSet,
} from '@/lib/workspace-source/application/types'

/**
 * The three-way rule every kind decides a declared resource with, from its fingerprint in the
 * directory (`local`), in the base the directory was read at (`base`) and on the server now
 * (`server`):
 *
 * | local vs base | server vs base | outcome |
 * |---|---|---|
 * | equal | any | `noop`, `serverChanged` when the server drifted |
 * | differs | equal | `apply` |
 * | differs | differs | `noop` when local equals server (recording the server as the new base), else `stale` |
 */
type ThreeWayOutcome =
  | { action: 'noop'; serverChanged: boolean; refreshed?: boolean }
  | { action: 'apply' }
  | { action: 'stale' }

function decide(local: string, base: string, server: string): ThreeWayOutcome {
  if (local === base) return { action: 'noop', serverChanged: server !== base }
  if (server === base) return { action: 'apply' }
  return local === server
    ? { action: 'noop', serverChanged: false, refreshed: true }
    : { action: 'stale' }
}

/** How a declared resource resolves against the server and the base, before kind-specific diffing. */
export type DeclaredResolution<S> =
  | { action: 'create' }
  | { action: 'adopt'; stored: StoredResource<S> }
  | { action: 'update'; stored: StoredResource<S>; base: BaseResource }
  | {
      action: 'noop'
      stored: StoredResource<S>
      serverChanged: boolean
      /**
       * Set when the no-op must record the server's base entry: the directory's base lacked one,
       * or the directory already holds what the server changed to.
       */
      refreshed?: boolean
    }
  | { action: 'stale'; stored: StoredResource<S> }
  | { action: 'no-base'; stored: StoredResource<S> }
  /**
   * The base records a resource the server no longer holds: deleted there. Never created again;
   * `stale` when the directory edited it since the base.
   */
  | { action: 'deleted'; stale: boolean }

/** Whether `set` still holds the resource `id`, under a key or unbound. */
export function holdsIn<S>(set: StoredSet<S>): (id: string) => boolean {
  const ids = new Set([...set.bound.values(), ...set.unbound].map((resource) => resource.id))
  return (id) => ids.has(id)
}

/**
 * Resolves one declared resource. With a base entry for the stored resource the three-way rule
 * decides; without one, a stored resource the source matches exactly is a no-op that records the
 * base (an earlier apply created it but never wrote its base back), and any other is
 * `no-base` (get it first). With nothing stored under the key, a resource the base records but
 * the server no longer holds was deleted there and stays deleted (`deleted`); otherwise an
 * unbound resource of the same name is adopted, else the resource is created.
 */
export function resolveDeclared<S>(input: {
  local: string
  stored?: StoredResource<S>
  adoptable?: StoredResource<S>
  base?: BaseResource
  fingerprint: (stored: StoredResource<S>, base?: BaseResource) => string
  /** Whether the server still holds a resource by id (see {@link holdsIn}). */
  holds: (id: string) => boolean
}): DeclaredResolution<S> {
  const { stored, base } = input
  if (!stored) {
    if (base?.fingerprint && !input.holds(base.id)) {
      return { action: 'deleted', stale: input.local !== base.fingerprint }
    }
    return input.adoptable ? { action: 'adopt', stored: input.adoptable } : { action: 'create' }
  }
  if (base && base.id === stored.id && base.fingerprint) {
    const server = input.fingerprint(stored, base)
    const outcome = decide(input.local, base.fingerprint, server)
    if (outcome.action === 'apply') return { action: 'update', stored, base }
    if (outcome.action === 'stale') return { action: 'stale', stored }
    return {
      action: 'noop',
      stored,
      serverChanged: outcome.serverChanged,
      ...(outcome.refreshed ? { refreshed: true } : {}),
    }
  }
  return input.local === input.fingerprint(stored)
    ? { action: 'noop', stored, serverChanged: false, refreshed: true }
    : { action: 'no-base', stored }
}

/**
 * Plans every resolution that writes nothing, the same way for every kind: deleted on the server,
 * stale, without a base, or a no-op (recording `baseOf(stored)` when it must refresh the base).
 * Returns `null` for a create, adopt or update, which the kind plans itself.
 */
export function settle<S, C extends PlannedChange>(
  resolution: DeclaredResolution<S>,
  change: C,
  baseOf: (stored: StoredResource<S>) => BaseResource
): C | null {
  const { kind, key } = change
  switch (resolution.action) {
    case 'deleted':
      change.diagnostics.push(serverGoneFinding(kind, key, resolution.stale))
      return change
    case 'stale':
      change.diagnostics.push(staleFinding(kind, key))
      return { ...change, storedId: resolution.stored.id }
    case 'no-base':
      change.diagnostics.push(noBaseFinding(kind, key))
      return { ...change, storedId: resolution.stored.id }
    case 'noop':
      if (resolution.serverChanged) change.diagnostics.push(serverChangedFinding(kind, key))
      return {
        ...change,
        storedId: resolution.stored.id,
        ...(resolution.refreshed ? { base: baseOf(resolution.stored) } : {}),
      }
    default:
      return null
  }
}
