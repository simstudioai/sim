const MAX_PAGE_CONTEXTS = 3

/** Bounds the combined page budget and refuses ambiguous snapshot identities within a turn. */
export function getPageContextBudgetError(
  contexts: readonly { kind: string; snapshot?: { id: string } }[]
): string | undefined {
  let count = 0
  const ids = new Set<string>()
  for (const context of contexts) {
    if (context.kind !== 'browser_page') continue
    if (++count > MAX_PAGE_CONTEXTS)
      return `At most ${MAX_PAGE_CONTEXTS} page snapshots can be attached`
    if (!context.snapshot) return 'A page snapshot is required'
    if (ids.has(context.snapshot.id)) return 'Page snapshot IDs must be unique within a message'
    ids.add(context.snapshot.id)
  }
}
