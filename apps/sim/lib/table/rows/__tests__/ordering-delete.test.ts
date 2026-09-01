/**
 * @vitest-environment node
 */
import { databaseMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutationProof } from '@/lib/table/mutation-locks'
import type { DbTransaction } from '@/lib/table/planner'

const { mockGetDeleteSnapshotBatchSize } = vi.hoisted(() => ({
  mockGetDeleteSnapshotBatchSize: vi.fn(() => 1),
}))

vi.mock('@/lib/table/constants', () => ({
  getDeleteSnapshotBatchSize: mockGetDeleteSnapshotBatchSize,
  TABLE_LIMITS: { DELETE_SNAPSHOT_BATCH_MAX_BYTES: 100, UPDATE_BATCH_SIZE: 100 },
}))
vi.mock('@/lib/table/tx', () => ({ setTableTxTimeouts: vi.fn() }))

import {
  type DeletedRowsHandler,
  deleteOrderedRowsByIds,
  deletePageByIds,
  planDeleteSnapshotBatch,
} from '@/lib/table/rows/ordering'

const mockTransaction = databaseMock.db.transaction as ReturnType<typeof vi.fn>
const proof = {} as MutationProof<'delete'>

type DeleteRunner = (onDeleted: DeletedRowsHandler) => Promise<unknown>

describe('ordered row delete trigger handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetDeleteSnapshotBatchSize.mockReturnValue(1)
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
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                for: async () => [{ id: `row-${batchIndex + 1}`, snapshotBytes: 20 }],
              }),
            }),
          }),
        }),
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

  it('splits one count-sized candidate batch at the snapshot byte budget', async () => {
    mockGetDeleteSnapshotBatchSize.mockReturnValue(3)
    const snapshots = [
      [
        { id: 'row-1', snapshotBytes: 60 },
        { id: 'row-2', snapshotBytes: 60 },
        { id: 'row-3', snapshotBytes: 10 },
      ],
      [
        { id: 'row-2', snapshotBytes: 60 },
        { id: 'row-3', snapshotBytes: 10 },
      ],
    ]
    const deletedBatches = [
      [{ id: 'row-1', data: { title: 'row-1' } }],
      [
        { id: 'row-2', data: { title: 'row-2' } },
        { id: 'row-3', data: { title: 'row-3' } },
      ],
    ]
    let transactionIndex = 0

    mockTransaction.mockImplementation(
      async (callback: (transaction: DbTransaction) => Promise<unknown>) => {
        const currentIndex = transactionIndex++
        const trx = {
          select: () => ({
            from: () => ({
              where: () => ({
                orderBy: () => ({
                  for: async () => snapshots[currentIndex],
                }),
              }),
            }),
          }),
          delete: () => ({
            where: () => ({
              returning: async () => deletedBatches[currentIndex],
            }),
          }),
        } as unknown as DbTransaction
        return callback(trx)
      }
    )
    const onDeleted = vi.fn()

    await expect(
      deleteOrderedRowsByIds({
        tableId: 'table-1',
        workspaceId: 'workspace-1',
        rowIds: ['row-1', 'row-2', 'row-3'],
        proof,
        onDeleted,
      })
    ).resolves.toEqual(['row-1', 'row-2', 'row-3'])

    expect(mockTransaction).toHaveBeenCalledTimes(2)
    expect(onDeleted.mock.calls.map(([rows]) => rows)).toEqual(deletedBatches)
  })
})

describe('delete snapshot byte planning', () => {
  it('stops before an existing row would exceed the byte budget', () => {
    expect(
      planDeleteSnapshotBatch(
        ['missing-row', 'row-1', 'row-2'],
        [
          { id: 'row-1', snapshotBytes: 60 },
          { id: 'row-2', snapshotBytes: 60 },
        ],
        100
      )
    ).toEqual({
      rowIds: ['missing-row', 'row-1'],
      consumedCount: 2,
      oversizedRow: undefined,
    })
  })

  it('isolates an oversized legacy row so no other snapshot joins it', () => {
    expect(
      planDeleteSnapshotBatch(
        ['legacy-row', 'row-2'],
        [
          { id: 'legacy-row', snapshotBytes: 150 },
          { id: 'row-2', snapshotBytes: 10 },
        ],
        100
      )
    ).toEqual({
      rowIds: ['legacy-row'],
      consumedCount: 1,
      oversizedRow: { id: 'legacy-row', snapshotBytes: 150 },
    })
  })
})
