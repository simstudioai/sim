/**
 * Names a multi-row selection for a confirmation prompt: one row reads as itself, several read
 * as a count. Shared so the wording stays identical across every resource list — the phrasing
 * appears in destructive confirms, where an inconsistency reads as a different action.
 */
export function selectionLabel(count: number, firstName: string | undefined): string {
  if (count === 1) return firstName ?? 'selected item'
  return `${count} selected items`
}

export function selectionActionLabel(
  action: string,
  selectedCount: number,
  singleItemLabel = action
): string {
  if (selectedCount <= 1) return singleItemLabel
  return `${action} ${selectedCount} items`
}

interface SelectionToggleActionLabelOptions {
  selectedCount: number
  enabledCount: number
  disabledCount: number
  isSelectedItemEnabled: boolean
}

export function selectionToggleActionLabel({
  selectedCount,
  enabledCount,
  disabledCount,
  isSelectedItemEnabled,
}: SelectionToggleActionLabelOptions): string {
  if (selectedCount <= 1) return isSelectedItemEnabled ? 'Disable' : 'Enable'
  if (disabledCount > 0) return selectionActionLabel('Enable', disabledCount)
  return selectionActionLabel('Disable', enabledCount)
}
