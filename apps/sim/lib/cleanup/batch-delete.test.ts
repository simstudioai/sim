/**
 * @vitest-environment node
 */

import { schemaMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'
import { batchDeleteByWorkspaceAndTimestamp, chunkedBatchDelete } from '@/lib/cleanup/batch-delete'

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

  it('forwards onBatch through batchDeleteByWorkspaceAndTimestamp', async () => {
    const order: string[] = []
    const onBatch = vi.fn(async () => {
      order.push('onBatch')
    })

    await batchDeleteByWorkspaceAndTimestamp({
      tableDef: schemaMock.folder as never,
      workspaceIdCol: schemaMock.folder.workspaceId as never,
      timestampCol: schemaMock.folder.deletedAt as never,
      workspaceIds: ['ws-1'],
      retentionDate: new Date(0),
      tableName: 'test/folder',
      requireTimestampNotNull: true,
      dbClient: createDbClient(() => order.push('delete'), [{ id: 'row-1' }]) as never,
      onBatch,
      batchSize: 1,
      maxBatches: 1,
    })

    // The wrapper spreads `...rest` into chunkedBatchDelete; `onBatch` must survive that hop.
    expect(onBatch).toHaveBeenCalled()
    expect(order[0]).toBe('onBatch')
  })
})
