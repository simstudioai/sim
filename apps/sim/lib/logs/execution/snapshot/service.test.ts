import { databaseMock } from '@sim/testing'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'generated-uuid-1'),
  generateShortId: vi.fn(() => 'generated-short-1'),
  isValidUuid: vi.fn((v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  ),
}))

import { SnapshotService } from '@/lib/logs/execution/snapshot/service'
import type { WorkflowState } from '@/lib/logs/types'

const mockState: WorkflowState = {
  blocks: {
    block1: {
      id: 'block1',
      name: 'Test Agent',
      type: 'agent',
      position: { x: 100, y: 200 },
      subBlocks: {},
      outputs: {},
      enabled: true,
      horizontalHandles: true,
      advancedMode: false,
      height: 0,
    },
  },
  edges: [{ id: 'edge1', source: 'block1', target: 'block2' }],
  loops: {},
  parallels: {},
}

describe('SnapshotService', () => {
  describe('computeStateHash', () => {
    it.concurrent('should ignore position changes', () => {
      const service = new SnapshotService()
      const baseState: WorkflowState = {
        blocks: {
          block1: {
            id: 'block1',
            name: 'Test Agent',
            type: 'agent',
            position: { x: 100, y: 200 },

            subBlocks: {},
            outputs: {},
            enabled: true,
            horizontalHandles: true,
            advancedMode: false,
            height: 0,
          },
        },
        edges: [],
        loops: {},
        parallels: {},
      }

      const stateWithDifferentPosition: WorkflowState = {
        ...baseState,
        blocks: {
          block1: {
            ...baseState.blocks.block1,
            position: { x: 500, y: 600 },
          },
        },
      }

      const hash1 = service.computeStateHash(baseState)
      const hash2 = service.computeStateHash(stateWithDifferentPosition)

      expect(hash1).toBe(hash2)
    })

    it.concurrent('should detect meaningful changes', () => {
      const service = new SnapshotService()
      const baseState: WorkflowState = {
        blocks: {
          block1: {
            id: 'block1',
            name: 'Test Agent',
            type: 'agent',
            position: { x: 100, y: 200 },

            subBlocks: {
              prompt: {
                id: 'prompt',
                type: 'short-input',
                value: 'Hello world',
              },
            },
            outputs: {},
            enabled: true,
            horizontalHandles: true,
            advancedMode: false,
            height: 0,
          },
        },
        edges: [],
        loops: {},
        parallels: {},
      }

      const stateWithDifferentPrompt: WorkflowState = {
        ...baseState,
        blocks: {
          block1: {
            ...baseState.blocks.block1,
            // Different subBlock value - this is a meaningful change
            subBlocks: {
              prompt: {
                id: 'prompt',
                type: 'short-input',
                value: 'Different prompt',
              },
            },
          },
        },
      }

      const hash1 = service.computeStateHash(baseState)
      const hash2 = service.computeStateHash(stateWithDifferentPrompt)

      expect(hash1).not.toBe(hash2)
    })

    it.concurrent('should handle edge order consistently', () => {
      const service = new SnapshotService()
      const state1: WorkflowState = {
        blocks: {},
        edges: [
          { id: 'edge1', source: 'a', target: 'b' },
          { id: 'edge2', source: 'b', target: 'c' },
        ],
        loops: {},
        parallels: {},
      }

      const state2: WorkflowState = {
        blocks: {},
        edges: [
          { id: 'edge2', source: 'b', target: 'c' },
          { id: 'edge1', source: 'a', target: 'b' },
        ],
        loops: {},
        parallels: {},
      }

      const hash1 = service.computeStateHash(state1)
      const hash2 = service.computeStateHash(state2)

      expect(hash1).toBe(hash2) // Should be same despite different order
    })

    it.concurrent('should detect changes in variable values', () => {
      const service = new SnapshotService()
      const state1: WorkflowState = {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        variables: {
          'var-1': {
            id: 'var-1',
            name: 'myVar',
            type: 'string',
            value: 'value1',
          },
        },
      }

      const state2: WorkflowState = {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        variables: {
          'var-1': {
            id: 'var-1',
            name: 'myVar',
            type: 'string',
            value: 'value2', // Different value
          },
        },
      }

      const hash1 = service.computeStateHash(state1)
      const hash2 = service.computeStateHash(state2)

      expect(hash1).not.toBe(hash2)
    })
  })

  describe('createSnapshotWithDeduplication', () => {
    type SnapshotRow = {
      id: string
      workflowId: string
      stateHash: string
      stateData: WorkflowState
      createdAt: Date
    }

    /** Mock the insert → values → onConflictDoUpdate → returning chain. */
    function mockUpsertReturning(rows: SnapshotRow[]) {
      let capturedConflictConfig: Record<string, unknown> | undefined
      const onConflictDoUpdate = vi.fn().mockImplementation((config: Record<string, unknown>) => {
        capturedConflictConfig = config
        return { returning: vi.fn().mockResolvedValue(rows) }
      })
      const values = vi.fn().mockReturnValue({ onConflictDoUpdate })
      databaseMock.db.insert = vi.fn().mockReturnValue({ values })
      databaseMock.db.select = vi.fn()
      return { values, onConflictDoUpdate, getConflictConfig: () => capturedConflictConfig }
    }

    it('reuses the existing snapshot atomically when the returned id differs', async () => {
      const service = new SnapshotService()
      const workflowId = 'wf-123'

      mockUpsertReturning([
        {
          id: 'existing-snapshot-id',
          workflowId,
          stateHash: 'abc123',
          stateData: mockState,
          createdAt: new Date('2026-02-19T00:00:00Z'),
        },
      ])

      const result = await service.createSnapshotWithDeduplication(workflowId, mockState)

      expect(result.snapshot.id).toBe('existing-snapshot-id')
      expect(result.isNew).toBe(false)
      expect(databaseMock.db.select).not.toHaveBeenCalled()
    })

    it('SET targets only state_hash on conflict, never the large state_data', async () => {
      const service = new SnapshotService()
      const workflowId = 'wf-123'

      const { onConflictDoUpdate, getConflictConfig } = mockUpsertReturning([
        {
          id: 'generated-uuid-1',
          workflowId,
          stateHash: 'abc123',
          stateData: mockState,
          createdAt: new Date('2026-02-19T00:00:00Z'),
        },
      ])

      await service.createSnapshotWithDeduplication(workflowId, mockState)

      expect(onConflictDoUpdate).toHaveBeenCalledTimes(1)
      const config = getConflictConfig()
      expect(config?.target).toBeDefined()
      // The crux of this change: the SET touches state_hash only, so the unchanged
      // TOASTed state_data jsonb is never rewritten.
      expect(config?.set).toHaveProperty('stateHash')
      expect(config?.set).not.toHaveProperty('stateData')
    })

    it('does not throw on concurrent inserts with the same hash', async () => {
      const service = new SnapshotService()
      const workflowId = 'wf-123'

      const newRow: SnapshotRow = {
        id: 'generated-uuid-1',
        workflowId,
        stateHash: 'abc123',
        stateData: mockState,
        createdAt: new Date('2026-02-19T00:00:00Z'),
      }
      const existingRow: SnapshotRow = { ...newRow, id: 'existing-snapshot-id' }

      let upsertCall = 0
      databaseMock.db.insert = vi.fn().mockImplementation(() => ({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(upsertCall++ === 0 ? [newRow] : [existingRow]),
          }),
        }),
      }))

      const [result1, result2] = await Promise.all([
        service.createSnapshotWithDeduplication(workflowId, mockState),
        service.createSnapshotWithDeduplication(workflowId, mockState),
      ])

      expect(result1.snapshot.id).toBe('generated-uuid-1')
      expect(result1.isNew).toBe(true)
      expect(result2.snapshot.id).toBe('existing-snapshot-id')
      expect(result2.isNew).toBe(false)
    })
  })

  describe('cleanupOrphanedSnapshots', () => {
    function setupCleanupMocks(selectBatches: Array<Array<{ id: string }>>) {
      const limitFn = vi.fn()
      for (const batch of selectBatches) limitFn.mockResolvedValueOnce(batch)
      limitFn.mockResolvedValue([])
      const whereSelect = vi.fn().mockReturnValue({ limit: limitFn })
      const fromFn = vi.fn().mockReturnValue({ where: whereSelect })
      databaseMock.db.select = vi.fn().mockReturnValue({ from: fromFn })

      const returningFn = vi.fn().mockImplementation(() => Promise.resolve([]))
      const whereDelete = vi.fn().mockReturnValue({ returning: returningFn })
      let batchIdx = 0
      const deleteFn = vi.fn().mockImplementation(() => {
        const batch = selectBatches[batchIdx] ?? []
        batchIdx++
        returningFn.mockImplementationOnce(() => Promise.resolve(batch.map((r) => ({ id: r.id }))))
        return { where: whereDelete }
      })
      databaseMock.db.delete = deleteFn

      return { deleteFn }
    }

    it('stops after the first short batch', async () => {
      const service = new SnapshotService()
      const partial = Array.from({ length: 3 }, (_, i) => ({ id: `s${i}` }))
      const { deleteFn } = setupCleanupMocks([partial])

      const count = await service.cleanupOrphanedSnapshots(7)

      expect(count).toBe(3)
      expect(deleteFn).toHaveBeenCalledTimes(1)
    })

    it('caps at MAX_BATCHES (20 × 1000) even when more rows remain', async () => {
      const service = new SnapshotService()
      const fullBatch = Array.from({ length: 1000 }, (_, i) => ({ id: `s${i}` }))
      const batches = Array.from({ length: 25 }, () => fullBatch)
      const { deleteFn } = setupCleanupMocks(batches)

      const count = await service.cleanupOrphanedSnapshots(7)

      expect(count).toBe(20_000)
      expect(deleteFn).toHaveBeenCalledTimes(20)
    })
  })
})
