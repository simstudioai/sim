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
  return countedSelectionActionLabel(action, selectedCount)
}

function countedSelectionActionLabel(action: string, count: number): string {
  return `${action} ${count} ${count === 1 ? 'item' : 'items'}`
}

interface SelectionToggleActionLabelOptions {
  selectedCount: number
  enabledCount: number
  disabledCount: number
  isSelectedItemEnabled: boolean
  hasExactAffectedCount?: boolean
}

export function selectionToggleActionLabel({
  selectedCount,
  enabledCount,
  disabledCount,
  isSelectedItemEnabled,
  hasExactAffectedCount = true,
}: SelectionToggleActionLabelOptions): string {
  if (selectedCount <= 1) return isSelectedItemEnabled ? 'Disable' : 'Enable'
  const action = disabledCount > 0 ? 'Enable' : 'Disable'
  if (!hasExactAffectedCount) return `${action} selected items`
  return countedSelectionActionLabel(action, disabledCount > 0 ? disabledCount : enabledCount)
}
