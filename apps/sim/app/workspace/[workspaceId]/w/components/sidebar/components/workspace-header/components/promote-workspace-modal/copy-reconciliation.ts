import type { ForkCopyableUnmapped, ForkMappingEntry } from '@/lib/api/contracts/workspace-fork'

/** `${kind}:${sourceId}` - the shared key for a mapping entry and its copy candidate. */
export const forkRefKey = (ref: { kind: string; sourceId: string }): string =>
  `${ref.kind}:${ref.sourceId}`

/** Effective mapping target: the in-session override, else the persisted target, else ''. */
export function effectiveForkTarget(
  entry: ForkMappingEntry,
  targets: Record<string, string>
): string {
  return targets[forkRefKey(entry)] ?? entry.targetId ?? ''
}

/**
 * Keys of copyable resources that already have a mapping target (in-session or persisted). Maps win
 * over copy, so these drop out of the copy list - the copy-vs-map reconciliation.
 */
export function forkMappedCopyableKeys(
  entries: ForkMappingEntry[],
  targets: Record<string, string>
): Set<string> {
  const keys = new Set<string>()
  for (const entry of entries) {
    if (effectiveForkTarget(entry, targets) !== '') keys.add(forkRefKey(entry))
  }
  return keys
}

/** Copy candidates the user has not mapped (a mapped copyable is excluded - copy-vs-map reconcile). */
export function forkVisibleCopyables(
  copyableUnmapped: ForkCopyableUnmapped[],
  mappedKeys: ReadonlySet<string>
): ForkCopyableUnmapped[] {
  return copyableUnmapped.filter((candidate) => !mappedKeys.has(forkRefKey(candidate)))
}

/** Keys of the visible copy candidates actually selected for copy. */
export function forkCopyingKeys(
  visibleCopyables: ForkCopyableUnmapped[],
  copySelected: ReadonlySet<string>
): Set<string> {
  const keys = new Set<string>()
  for (const candidate of visibleCopyables) {
    const key = forkRefKey(candidate)
    if (copySelected.has(key)) keys.add(key)
  }
  return keys
}

/**
 * Whether every required reference is satisfied - it has a mapping target OR is selected for copy.
 * The server accepts a copy as resolving a required ref (promote.ts `willResolve`), so the client
 * gate must too. No double-count: a mapped copyable is excluded from the copy candidates, so the two
 * branches are mutually exclusive.
 */
export function isForkRequiredComplete(
  entries: ForkMappingEntry[],
  targets: Record<string, string>,
  copyingKeys: ReadonlySet<string>
): boolean {
  return entries.every(
    (entry) =>
      !entry.required ||
      effectiveForkTarget(entry, targets) !== '' ||
      copyingKeys.has(forkRefKey(entry))
  )
}

/**
 * Whether any reference in a kind is required AND still unmapped AND not selected for copy - drives
 * the overview's amber "pending" badge. Mirrors {@link isForkRequiredComplete}'s satisfied rule.
 */
export function forkRequiredPending(
  items: ForkMappingEntry[],
  targets: Record<string, string>,
  copyingKeys: ReadonlySet<string>
): boolean {
  return items.some(
    (entry) =>
      entry.required &&
      effectiveForkTarget(entry, targets) === '' &&
      !copyingKeys.has(forkRefKey(entry))
  )
}
