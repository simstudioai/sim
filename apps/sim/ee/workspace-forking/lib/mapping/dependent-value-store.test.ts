import { describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'
import type { ForkReferenceResolver } from '@/lib/workflows/references/remap-references'
import {
  type ForkDependentValue,
  forkDependentValueKey,
  reconcileForkDependentValues,
  translateForkDependentValues,
} from '@/ee/workspace-forking/lib/mapping/dependent-value-store'

describe('forkDependentValueKey', () => {
  it("doesn't collide when an id contains a printable separator", () => {
    // 'a:b' + 'c' must differ from 'a' + 'b:c' - the NUL separator guarantees it.
    expect(forkDependentValueKey('a:b', 'c', 'd')).not.toBe(forkDependentValueKey('a', 'b:c', 'd'))
  })
})

describe('translateForkDependentValues', () => {
  const value = (overrides: Partial<ForkDependentValue> = {}): ForkDependentValue => ({
    targetWorkflowId: 'wf-1',
    targetBlockId: 'blk-1',
    subBlockKey: 'documentSelector',
    value: 'doc-src',
    ...overrides,
  })

  /** Resolver mapping only the copied/mapped source document ids, like promote's post-copy one. */
  const resolver: ForkReferenceResolver = (kind, sourceId) =>
    kind === 'knowledge-document' && sourceId === 'doc-src' ? 'doc-copy' : null

  it('rewrites a SOURCE document id to its copied counterpart (the apply must never write a source id)', () => {
    expect(translateForkDependentValues([value()], resolver)).toEqual([
      value({ value: 'doc-copy' }),
    ])
  })

  it('keeps values the resolver does not know verbatim (target doc ids, labels, column ids)', () => {
    const targetDoc = value({ value: 'doc-tgt-existing' })
    const label = value({ subBlockKey: 'folder', value: 'INBOX' })
    expect(translateForkDependentValues([targetDoc, label], resolver)).toEqual([targetDoc, label])
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
