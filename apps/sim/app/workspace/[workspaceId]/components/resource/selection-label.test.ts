import { describe, expect, it } from 'vitest'
import {
  selectionActionLabel,
  selectionLabel,
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
})
