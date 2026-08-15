/**
 * Names a multi-row selection for a confirmation prompt: one row reads as itself, several read
 * as a count. Shared so the wording stays identical across every resource list — the phrasing
 * appears in destructive confirms, where an inconsistency reads as a different action.
 */
export function selectionLabel(count: number, firstName: string | undefined): string {
  if (count === 1) return firstName ?? 'selected item'
  return `${count} selected items`
}
