import type { BaseResource, WorkspaceKind } from '@sim/workspace-code'
import {
  noBaseFinding,
  serverChangedFinding,
  serverGoneFinding,
  staleFinding,
  unreadAdoptFinding,
} from '@/lib/workspace-source/application/findings'
import type {
  KindChange,
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
 * | differs | differs | `noop` if local equals server (base refreshed), else `stale` |
 *
 * A kind that writes a resource in parts refines `stale` part by part (see `partway`).
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

/**
 * A resource's fingerprint split into parts that its write commits one at a time (a deployment's
 * `api` and `chat`), each the fingerprint of that part's canonical value. A part missing from one
 * side differs from every part present on the other.
 */
export type PartFingerprints = Readonly<Record<string, string>>

/**
 * Whether a server that differs from both the base and the directory is only partway from one to
 * the other: every part the server holds is either the base's or the directory's. That is what an
 * apply interrupted between two of a resource's writes leaves, and applying the rest finishes it.
 * A part that matches neither moved on the server since the base: stale.
 */
function partway(local: PartFingerprints, base: PartFingerprints, server: PartFingerprints) {
  const parts = new Set([...Object.keys(local), ...Object.keys(base), ...Object.keys(server)])
  return [...parts].every((part) => server[part] === base[part] || server[part] === local[part])
}

/** How a declared resource resolves against the server and the base, before kind diffing. */
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
 * unbound resource of the same name is adopted (which may only add to it, see
 * {@link refuseUnreadAdopt}), else the resource is created.
 */
export function resolveDeclared<S>(input: {
  local: string
  stored?: StoredResource<S>
  adoptable?: StoredResource<S>
  base?: BaseResource
  fingerprint: (stored: StoredResource<S>, base?: BaseResource) => string
  /** Whether the server still holds a resource by id (see {@link holdsIn}). */
  holds: (id: string) => boolean
  /**
   * For a kind whose write commits in parts: the directory's parts, the base's (as the base entry
   * records them; absent in a base written before it did), and the stored resource's. With all
   * three, a server partway from the base to the directory is an update, not stale (see
   * {@link partway}).
   */
  parts?: {
    local: PartFingerprints
    base: PartFingerprints | undefined
    server: (stored: StoredResource<S>, base?: BaseResource) => PartFingerprints | undefined
  }
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
    if (outcome.action === 'stale') {
      const { parts } = input
      const server = parts?.base ? parts.server(stored, base) : undefined
      return parts?.base && server && partway(parts.local, parts.base, server)
        ? { action: 'update', stored, base }
        : { action: 'stale', stored }
    }
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

/** A resolution the kind plans itself: a create, an adopt or an update. */
type WriteResolution<S> = Extract<DeclaredResolution<S>, { action: 'create' | 'adopt' | 'update' }>

/**
 * Plans every resolution that writes nothing, the same way for every kind: deleted on the server,
 * stale, without a base, or a no-op (recording `baseOf(stored)` when it must refresh the base),
 * returned as `settled`. A create, adopt or update comes back as the narrowed resolution, which
 * the kind plans itself.
 */
export function settle<S, C extends KindChange<WorkspaceKind>>(
  resolution: DeclaredResolution<S>,
  change: C,
  baseOf: (stored: StoredResource<S>) => BaseResource
): { settled: C } | WriteResolution<S> {
  const { kind, key } = change
  switch (resolution.action) {
    case 'deleted':
      change.diagnostics.push(serverGoneFinding(kind, key, resolution.stale))
      return { settled: change }
    case 'stale':
      change.diagnostics.push(staleFinding(kind, key))
      return { settled: { ...change, storedId: resolution.stored.id } }
    case 'no-base':
      change.diagnostics.push(noBaseFinding(kind, key))
      return { settled: { ...change, storedId: resolution.stored.id } }
    case 'noop':
      if (resolution.serverChanged) change.diagnostics.push(serverChangedFinding(kind, key))
      return {
        settled: {
          ...change,
          storedId: resolution.stored.id,
          ...(resolution.refreshed ? { base: baseOf(resolution.stored) } : {}),
        },
      }
    default:
      return resolution
  }
}

/**
 * Refuses an adopt that would change or remove anything the stored resource holds: the directory
 * never read that resource (no source named it), so like a bound resource without a base
 * (`no-base`) it cannot tell its declaration from someone else's work. An adopt may still add
 * what the resource lacks, so an apply that stopped after creating a resource (a knowledge base
 * before its documents, a table before its rows) finishes it, and a declaration that matches the
 * resource binds its key. `changes` names what the adopt would change or remove (the plan's
 * field labels); empty lets the adopt go ahead and returns `undefined`.
 */
export function refuseUnreadAdopt<C extends KindChange<WorkspaceKind>>(
  change: C,
  stored: Pick<StoredResource<unknown>, 'id' | 'name'>,
  changes: readonly string[]
): C | undefined {
  if (changes.length === 0) return undefined
  return {
    ...change,
    action: 'noop',
    storedId: stored.id,
    diagnostics: [
      ...change.diagnostics,
      unreadAdoptFinding(change.kind, change.key, stored.name, changes),
    ],
  }
}
