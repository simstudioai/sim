interface StaleSelectionOption {
  label: string
  id: string
}

interface StaleSelectionParams {
  /** The field's current multi-select values. */
  selected: readonly string[]
  /** Ids the picker can already render (loaded remote list plus any hydrated/static rows). */
  optionIds: ReadonlySet<string>
  /** Whether the remote list is authoritative right now (loaded, non-empty, not errored). */
  listLoaded: boolean
}

/**
 * Rows for selected values that a loaded remote list no longer contains.
 *
 * A multi-select toggles a value off by clicking its row, and a deleted resource
 * (a dropped table column) has no row — the selection would be stuck until the
 * parent changes. Giving each stale value its own row makes it removable in
 * place. The row is labelled with the stored id itself: a value that resolves
 * shows its name, one that doesn't shows the id (as a mail client shows a raw
 * label id once the label is gone). Nothing is reported while the list is
 * still loading or failed (every value would look stale), and run-time
 * expressions are never stale — they resolve later.
 */
export function staleSelectionOptions({
  selected,
  optionIds,
  listLoaded,
}: StaleSelectionParams): StaleSelectionOption[] {
  if (!listLoaded) return []
  const stale: StaleSelectionOption[] = []
  const seen = new Set<string>()
  for (const value of selected) {
    if (!value || seen.has(value) || optionIds.has(value)) continue
    if (value.startsWith('<') || value.includes('{{')) continue
    seen.add(value)
    stale.push({ id: value, label: value })
  }
  return stale
}
