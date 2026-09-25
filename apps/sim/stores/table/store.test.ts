import { beforeEach, describe, expect, it } from 'vitest'
import { useTableUndoStore } from '@/stores/table/store'
import type { TableUndoAction } from '@/stores/table/types'

const TABLE = 'tbl-1'

const reorder: TableUndoAction = {
  type: 'reorder-columns',
  previousOrder: ['a', 'b'],
  newOrder: ['b', 'a'],
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

  it('prunes the redo stack too, so redo cannot replay into the wrong view', () => {
    const store = useTableUndoStore.getState()
    store.push(TABLE, reorder, 'view-a')
    store.popUndo(TABLE)
    expect(useTableUndoStore.getState().stacks[TABLE]?.redo).toHaveLength(1)

    store.pruneLayoutActions(TABLE, 'view-b')

    expect(useTableUndoStore.getState().stacks[TABLE]?.redo).toHaveLength(0)
  })
})
