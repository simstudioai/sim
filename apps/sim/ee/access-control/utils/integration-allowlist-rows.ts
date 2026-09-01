import { toAccessControlAllowlist } from '@/lib/permission-groups/block-access'

/**
 * The stored `allowedIntegrations` re-expressed as editor rows: successor-
 * resolved the way the runtime resolves it, then projected onto the universe of
 * rows the editor actually offers. `null` stays `null` — everything allowed.
 *
 * A stored list can name a retired id (written before the universe excluded
 * superseded blocks, or through the API directly). The runtime resolves it to
 * its successor, so a stored `slack` allows `slack_v2`; reading the raw strings
 * would render that row unchecked, and toggling it would "enable" an
 * integration that was already permitted. Resolving first makes the checkbox
 * tell the truth, and the projection drops the stale id on the next write.
 */
export function allowlistRowsFromStored(
  universe: readonly string[],
  stored: readonly string[] | null
): Set<string> | null {
  const resolved = toAccessControlAllowlist(stored)
  return resolved === null ? null : new Set(universe.filter((type) => resolved.has(type)))
}

/**
 * The stored allowlist after a set of rows is allowed or denied.
 *
 * Always emitted in universe order and collapsed back to `null` — unrestricted
 * — when every row survives, so a group that ends up permitting everything is
 * stored as "no restriction" rather than as a list that silently freezes out
 * every integration added later.
 */
export function withAllowlistRows(
  universe: readonly string[],
  stored: readonly string[] | null,
  blockTypes: readonly string[],
  allowed: boolean
): string[] | null {
  const rows = allowlistRowsFromStored(universe, stored) ?? new Set(universe)
  for (const blockType of blockTypes) {
    if (allowed) rows.add(blockType)
    else rows.delete(blockType)
  }
  const next = universe.filter((type) => rows.has(type))
  return next.length === universe.length ? null : next
}

/** {@link withAllowlistRows} for one row, flipping whatever it is now. */
export function toggleAllowlistRow(
  universe: readonly string[],
  stored: readonly string[] | null,
  blockType: string
): string[] | null {
  const rows = allowlistRowsFromStored(universe, stored)
  return withAllowlistRows(universe, stored, [blockType], !(rows === null || rows.has(blockType)))
}
