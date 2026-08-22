import { describe, expect, it } from 'vitest'
import {
  selectionActionLabel,
  selectionLabel,
  selectionToggleActionLabel,
} from '@/app/workspace/[workspaceId]/components/resource/selection-label'

describe('selection labels', () => {
  it('uses the selected item name for a single-row confirmation', () => {
    expect(selectionLabel(1, 'Quarterly data')).toBe('Quarterly data')
  })

  it('uses the selection count for a multi-row confirmation', () => {
    expect(selectionLabel(3, 'Quarterly data')).toBe('3 selected items')
  })

  it('keeps single-row action labels terse', () => {
    expect(selectionActionLabel('Move', 1, 'Move to')).toBe('Move to')
  })

  it('states the scope of a multi-row action', () => {
    expect(selectionActionLabel('Delete', 3)).toBe('Delete 3 items')
  })

  it('counts only disabled items for a mixed-selection enable action', () => {
    expect(
      selectionToggleActionLabel({
        selectedCount: 5,
        enabledCount: 2,
        disabledCount: 3,
        isSelectedItemEnabled: true,
      })
    ).toBe('Enable 3 items')
  })

  it('keeps a singular affected count visible within a larger selection', () => {
    expect(
      selectionToggleActionLabel({
        selectedCount: 5,
        enabledCount: 4,
        disabledCount: 1,
        isSelectedItemEnabled: true,
      })
    ).toBe('Enable 1 item')
  })

  it('counts enabled items when a selection can only be disabled', () => {
    expect(
      selectionToggleActionLabel({
        selectedCount: 4,
        enabledCount: 4,
        disabledCount: 0,
        isSelectedItemEnabled: true,
      })
    ).toBe('Disable 4 items')
  })

  it('keeps the action selection-aware when the affected subset count is unknown', () => {
    expect(
      selectionToggleActionLabel({
        selectedCount: 10,
        enabledCount: 10,
        disabledCount: 10,
        isSelectedItemEnabled: true,
        hasExactAffectedCount: false,
      })
    ).toBe('Enable selected items')
  })
})
