/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useTableUndoStore } from '@/stores/table/store'
import type { TableUndoAction } from '@/stores/table/types'

const TABLE = 'tbl-1'

const reorder: TableUndoAction = {
  type: 'reorder-columns',
  previousOrder: ['a', 'b'],
  newOrder: ['b', 'a'],
}
const updateCell: TableUndoAction = {
  type: 'update-cell',
  rowId: 'r1',
  columnName: 'a',
  previousValue: 1,
  newValue: 2,
}

describe('pruneLayoutActions', () => {
  beforeEach(() => {
    useTableUndoStore.getState().clear(TABLE)
  })

  it('drops a layout action recorded under a different view', () => {
    const store = useTableUndoStore.getState()
    store.push(TABLE, reorder, 'view-a')

    store.pruneLayoutActions(TABLE, 'view-b')

    expect(useTableUndoStore.getState().stacks[TABLE]?.undo).toHaveLength(0)
  })

  it('keeps a layout action when the owning view is still active', () => {
    const store = useTableUndoStore.getState()
    store.push(TABLE, reorder, 'view-a')

    store.pruneLayoutActions(TABLE, 'view-a')

    expect(useTableUndoStore.getState().stacks[TABLE]?.undo).toHaveLength(1)
  })

  it('keeps row actions across a view switch — rows are table-scoped', () => {
    const store = useTableUndoStore.getState()
    store.push(TABLE, updateCell, 'view-a')

    store.pruneLayoutActions(TABLE, 'view-b')

    const undo = useTableUndoStore.getState().stacks[TABLE]?.undo
    expect(undo).toHaveLength(1)
    expect(undo?.[0].action.type).toBe('update-cell')
  })

  it('prunes the redo stack too, so redo cannot replay into the wrong view', () => {
    const store = useTableUndoStore.getState()
    store.push(TABLE, reorder, 'view-a')
    store.popUndo(TABLE)
    expect(useTableUndoStore.getState().stacks[TABLE]?.redo).toHaveLength(1)

    store.pruneLayoutActions(TABLE, 'view-b')

    expect(useTableUndoStore.getState().stacks[TABLE]?.redo).toHaveLength(0)
  })

  it('treats All (null) as its own owner', () => {
    const store = useTableUndoStore.getState()
    store.push(TABLE, reorder, null)

    store.pruneLayoutActions(TABLE, 'view-a')
    expect(useTableUndoStore.getState().stacks[TABLE]?.undo).toHaveLength(0)
  })
})
