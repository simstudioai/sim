/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import {
  forkDependentValueKey,
  loadForkDependentValues,
  reconcileForkDependentValues,
} from '@/lib/workspaces/fork/mapping/dependent-value-store'

describe('forkDependentValueKey', () => {
  it('builds a stable triple key', () => {
    expect(forkDependentValueKey('wf', 'blk', 'folder')).toBe('wf\u0000blk\u0000folder')
  })

  it("doesn't collide when an id contains a printable separator", () => {
    // 'a:b' + 'c' must differ from 'a' + 'b:c' - the NUL separator guarantees it.
    expect(forkDependentValueKey('a:b', 'c', 'd')).not.toBe(forkDependentValueKey('a', 'b:c', 'd'))
  })
})

describe('loadForkDependentValues', () => {
  it('selects the edge rows', async () => {
    const where = vi
      .fn()
      .mockResolvedValue([
        { targetWorkflowId: 'wf', targetBlockId: 'b', subBlockKey: 'folder', value: 'INBOX' },
      ])
    const from = vi.fn(() => ({ where }))
    const executor = { select: vi.fn(() => ({ from })) }
    const rows = await loadForkDependentValues(executor as unknown as DbOrTx, 'ws-1')
    expect(executor.select).toHaveBeenCalledTimes(1)
    expect(rows).toEqual([
      { targetWorkflowId: 'wf', targetBlockId: 'b', subBlockKey: 'folder', value: 'INBOX' },
    ])
  })

  it('scopes the read to the given target workflows', async () => {
    const where = vi.fn().mockResolvedValue([])
    const from = vi.fn(() => ({ where }))
    const executor = { select: vi.fn(() => ({ from })) }
    await loadForkDependentValues(executor as unknown as DbOrTx, 'ws-1', ['wf-1', 'wf-2'])
    expect(executor.select).toHaveBeenCalledTimes(1)
    expect(where).toHaveBeenCalledTimes(1)
  })

  it('short-circuits an empty target filter without querying', async () => {
    const executor = { select: vi.fn() }
    const rows = await loadForkDependentValues(executor as unknown as DbOrTx, 'ws-1', [])
    expect(executor.select).not.toHaveBeenCalled()
    expect(rows).toEqual([])
  })
})

describe('reconcileForkDependentValues', () => {
  function fakeExecutor() {
    const deleteWhere = vi.fn().mockResolvedValue(undefined)
    const insertValues = vi.fn().mockResolvedValue(undefined)
    const executor = {
      delete: vi.fn(() => ({ where: deleteWhere })),
      insert: vi.fn(() => ({ values: insertValues })),
    }
    return { executor: executor as unknown as DbOrTx, deleteWhere, insertValues }
  }

  it('deletes the given workflows then inserts only non-empty values', async () => {
    const { executor, deleteWhere, insertValues } = fakeExecutor()
    await reconcileForkDependentValues(
      executor,
      'ws-1',
      ['wf-1'],
      [
        { targetWorkflowId: 'wf-1', targetBlockId: 'b1', subBlockKey: 'folder', value: 'INBOX' },
        { targetWorkflowId: 'wf-1', targetBlockId: 'b2', subBlockKey: 'folder', value: '' },
      ]
    )
    expect(deleteWhere).toHaveBeenCalledTimes(1)
    expect(insertValues).toHaveBeenCalledTimes(1)
    const rows = insertValues.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      childWorkspaceId: 'ws-1',
      targetWorkflowId: 'wf-1',
      targetBlockId: 'b1',
      subBlockKey: 'folder',
      value: 'INBOX',
    })
  })

  it('skips the delete when no workflows are given, and skips insert when all values are empty', async () => {
    const { executor, deleteWhere, insertValues } = fakeExecutor()
    await reconcileForkDependentValues(
      executor,
      'ws-1',
      [],
      [{ targetWorkflowId: 'wf-1', targetBlockId: 'b1', subBlockKey: 'folder', value: '' }]
    )
    expect(deleteWhere).not.toHaveBeenCalled()
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('clears a workflow (delete, no insert) when its full set is now empty', async () => {
    const { executor, deleteWhere, insertValues } = fakeExecutor()
    await reconcileForkDependentValues(executor, 'ws-1', ['wf-1'], [])
    expect(deleteWhere).toHaveBeenCalledTimes(1)
    expect(insertValues).not.toHaveBeenCalled()
  })

  it('dedupes duplicate field entries (last value wins) so a retried payload cannot trip the unique index', async () => {
    const { executor, insertValues } = fakeExecutor()
    await reconcileForkDependentValues(
      executor,
      'ws-1',
      ['wf-1'],
      [
        { targetWorkflowId: 'wf-1', targetBlockId: 'b1', subBlockKey: 'folder', value: 'INBOX' },
        { targetWorkflowId: 'wf-1', targetBlockId: 'b1', subBlockKey: 'folder', value: 'SENT' },
      ]
    )
    expect(insertValues).toHaveBeenCalledTimes(1)
    const rows = insertValues.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      targetWorkflowId: 'wf-1',
      targetBlockId: 'b1',
      subBlockKey: 'folder',
      value: 'SENT',
    })
  })
})
