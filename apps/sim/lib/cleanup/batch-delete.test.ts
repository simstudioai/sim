import { schemaMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import { chunkedBatchDelete, selectRowsByIdChunks } from '@/lib/cleanup/batch-delete'

/**
 * Minimal stand-in for the drizzle client `chunkedBatchDelete` calls. Only the DELETE path is
 * modelled — the SELECT arrives through the caller-supplied `selectChunk`.
 */
function createDbClient(onDelete: () => void, selectRows: Array<{ id: string }> = []) {
  return {
    // `batchDeleteByWorkspaceAndTimestamp` builds its own selectChunk on this client.
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => selectRows }) }),
    }),
    delete: () => {
      onDelete()
      return { where: () => ({ returning: async () => [{ id: 'row-1' }] }) }
    },
  } as never
}

/**
 * These two assertions guard the single link that makes the folder re-root hook live. Every
 * test in `cleanup-soft-deletes.test.ts` invokes the captured `onBatch` directly with
 * `batchDeleteByWorkspaceAndTimestamp` mocked out, so a regression that stopped forwarding the
 * hook — or ran it after the DELETE — would leave that whole suite green.
 */
describe('chunkedBatchDelete onBatch contract', () => {
  it('runs onBatch BEFORE the delete for the same rows', async () => {
    const order: string[] = []
    const onBatch = vi.fn(async (rows: Array<{ id: string }>) => {
      order.push(`onBatch:${rows.map((r) => r.id).join(',')}`)
    })

    await chunkedBatchDelete({
      tableDef: schemaMock.folder as never,
      workspaceIds: ['ws-1'],
      tableName: 'test/folder',
      dbClient: createDbClient(() => order.push('delete')),
      selectChunk: async () => [{ id: 'row-1' }],
      onBatch,
      batchSize: 1,
      maxBatches: 1,
      totalRowLimit: 1,
    })

    expect(onBatch).toHaveBeenCalledWith([{ id: 'row-1' }])
    // Ordering is the load-bearing half: renaming children after the DELETE would be useless.
    expect(order).toEqual(['onBatch:row-1', 'delete'])
  })
})

describe('shared cleanup row budgets', () => {
  it('caps selection across ID chunks and subsequent owner scopes', async () => {
    const budget = { remaining: 3 }
    const select = vi.fn(async (_ids: string[], limit: number) =>
      [{ id: 'one' }, { id: 'two' }].slice(0, limit)
    )
    expect(await selectRowsByIdChunks(['a', 'b'], select, { chunkSize: 1, budget })).toHaveLength(3)
    expect(select.mock.calls.map(([, limit]) => limit)).toEqual([3, 1])
    expect(await selectRowsByIdChunks(['c'], select, { budget })).toEqual([])
    expect(select).toHaveBeenCalledTimes(2)
  })

  it('charges restored rows as attempts and uses the remaining limit for each delete batch', async () => {
    const budget = { remaining: 3 }
    const select = vi.fn(async (_ids: string[], limit: number) =>
      [{ id: 'one' }, { id: 'two' }].slice(0, limit)
    )
    const options = {
      tableDef: schemaMock.folder as never,
      workspaceIds: ['a'],
      tableName: 'folder',
      dbClient: createDbClient(() => {}),
      selectChunk: select,
      budget,
      batchSize: 2,
    }
    const result = await chunkedBatchDelete(options)
    expect(result).toMatchObject({ deleted: 2, failed: 1 })
    expect(select.mock.calls.map(([, limit]) => limit)).toEqual([2, 1])
    await chunkedBatchDelete({ ...options, workspaceIds: ['b'] })
    expect(select).toHaveBeenCalledTimes(2)
  })

  it('stops on an error after charging selected rows', async () => {
    const budget = { remaining: 2 }
    const onDelete = vi.fn()
    await expect(
      chunkedBatchDelete({
        tableDef: schemaMock.folder as never,
        workspaceIds: ['a', 'b'],
        tableName: 'folder',
        budget,
        dbClient: createDbClient(onDelete),
        selectChunk: async () => [{ id: 'one' }],
        onBatch: async () => {
          throw new Error('storage failed')
        },
      })
    ).rejects.toThrow('storage failed')
    expect(budget.remaining).toBe(1)
    expect(onDelete).not.toHaveBeenCalled()
  })
})
