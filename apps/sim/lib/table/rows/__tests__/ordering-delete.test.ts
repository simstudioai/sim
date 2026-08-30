/**
 * @vitest-environment node
 */
import { databaseMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutationProof } from '@/lib/table/mutation-locks'
import type { DbTransaction } from '@/lib/table/planner'

vi.mock('@/lib/table/constants', () => ({
  getDeleteSnapshotBatchSize: () => 1,
  TABLE_LIMITS: { UPDATE_BATCH_SIZE: 100 },
}))
vi.mock('@/lib/table/tx', () => ({ setTableTxTimeouts: vi.fn() }))

import {
  type DeletedRowsHandler,
  deleteOrderedRowsByIds,
  deletePageByIds,
} from '@/lib/table/rows/ordering'

const mockTransaction = databaseMock.db.transaction as ReturnType<typeof vi.fn>
const proof = {} as MutationProof<'delete'>

type DeleteRunner = (onDeleted: DeletedRowsHandler) => Promise<unknown>

describe('ordered row delete trigger handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    [
      'direct deletes',
      (onDeleted: DeletedRowsHandler) =>
        deleteOrderedRowsByIds({
          tableId: 'table-1',
          workspaceId: 'workspace-1',
          rowIds: ['row-1', 'row-2'],
          proof,
          onDeleted,
        }),
    ],
    [
      'background delete pages',
      (onDeleted: DeletedRowsHandler) =>
        deletePageByIds('table-1', 'workspace-1', ['row-1', 'row-2'], proof, undefined, onDeleted),
    ],
  ])(
    'runs %s handlers after commit and before the next batch',
    async (_label, run: DeleteRunner) => {
      const events: string[] = []
      let batchIndex = 0
      let releaseFirstHandler: (() => void) | undefined
      const firstHandlerGate = new Promise<void>((resolve) => {
        releaseFirstHandler = resolve
      })
      const trx = {
        delete: () => ({
          where: () => ({
            returning: async () => {
              const id = `row-${batchIndex + 1}`
              batchIndex++
              return [{ id, data: { title: id } }]
            },
          }),
        }),
      } as unknown as DbTransaction

      mockTransaction.mockImplementation(
        async (callback: (transaction: DbTransaction) => Promise<unknown>) => {
          const result = await callback(trx)
          events.push(`commit-${mockTransaction.mock.calls.length}`)
          return result
        }
      )

      const onDeleted = vi.fn(async (rows: Array<{ id: string }>) => {
        events.push(`trigger-${rows[0]?.id}`)
        if (rows[0]?.id === 'row-1') await firstHandlerGate
      })
      const pending = run(onDeleted)

      await vi.waitFor(() => {
        expect(events).toEqual(['commit-1', 'trigger-row-1'])
      })
      expect(mockTransaction).toHaveBeenCalledTimes(1)

      releaseFirstHandler?.()
      await pending

      expect(events).toEqual(['commit-1', 'trigger-row-1', 'commit-2', 'trigger-row-2'])
      expect(onDeleted.mock.calls.map(([rows]) => rows)).toEqual([
        [{ id: 'row-1', data: { title: 'row-1' } }],
        [{ id: 'row-2', data: { title: 'row-2' } }],
      ])
    }
  )
})
