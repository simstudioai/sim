/**
 * @vitest-environment node
 */
import { databaseMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('computeStateHash', () => {
    it.concurrent('should generate consistent hashes for identical states', () => {
      const service = new SnapshotService()
      const state: WorkflowState = {
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

      const hash1 = service.computeStateHash(state)
      const hash2 = service.computeStateHash(state)

      expect(hash1).toBe(hash2)
      expect(hash1).toHaveLength(64) // SHA-256 hex string
    })

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

    it.concurrent('should handle empty states', () => {
      const service = new SnapshotService()
      const emptyState: WorkflowState = {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
      }

      const hash = service.computeStateHash(emptyState)
      expect(hash).toHaveLength(64)
    })

    it.concurrent('should handle complex nested structures', () => {
      const service = new SnapshotService()
      const complexState: WorkflowState = {
        blocks: {
          block1: {
            id: 'block1',
            name: 'Complex Agent',
            type: 'agent',
            position: { x: 100, y: 200 },

            subBlocks: {
              prompt: {
                id: 'prompt',
                type: 'short-input',
                value: 'Test prompt',
              },
              model: {
                id: 'model',
                type: 'short-input',
                value: 'gpt-4',
              },
            },
            outputs: {
              response: { type: 'string', description: 'Agent response' },
            },
            enabled: true,
            horizontalHandles: true,
            advancedMode: true,
            height: 200,
          },
        },
        edges: [{ id: 'edge1', source: 'block1', target: 'block2', sourceHandle: 'output' }],
        loops: {
          loop1: {
            id: 'loop1',
            nodes: ['block1'],
            iterations: 10,
            loopType: 'for',
          },
        },
        parallels: {
          parallel1: {
            id: 'parallel1',
            nodes: ['block1'],
            count: 3,
            parallelType: 'count',
          },
        },
      }

      const hash = service.computeStateHash(complexState)
      expect(hash).toHaveLength(64)

      const hash2 = service.computeStateHash(complexState)
      expect(hash).toBe(hash2)
    })

    it.concurrent('should include variables in hash computation', () => {
      const service = new SnapshotService()
      const stateWithVariables: WorkflowState = {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        variables: {
          'var-1': {
            id: 'var-1',
            name: 'apiKey',
            type: 'string',
            value: 'secret123',
          },
        },
      }

      const stateWithoutVariables: WorkflowState = {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
      }

      const hashWith = service.computeStateHash(stateWithVariables)
      const hashWithout = service.computeStateHash(stateWithoutVariables)

      expect(hashWith).not.toBe(hashWithout)
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

    it.concurrent('should generate consistent hashes for states with variables', () => {
      const service = new SnapshotService()
      const stateWithVariables: WorkflowState = {
        blocks: {
          block1: {
            id: 'block1',
            name: 'Test',
            type: 'agent',
            position: { x: 0, y: 0 },
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
        variables: {
          'var-1': {
            id: 'var-1',
            name: 'testVar',
            type: 'plain',
            value: 'testValue',
          },
          'var-2': {
            id: 'var-2',
            name: 'anotherVar',
            type: 'number',
            value: 42,
          },
        },
      }

      const hash1 = service.computeStateHash(stateWithVariables)
      const hash2 = service.computeStateHash(stateWithVariables)

      expect(hash1).toBe(hash2)
      expect(hash1).toHaveLength(64)
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

    /** Mock the insert → values → onConflictDoNothing → returning chain. */
    function mockInsertReturning(rows: SnapshotRow[]) {
      let capturedConflictConfig: Record<string, unknown> | undefined
      const onConflictDoNothing = vi.fn().mockImplementation((config: Record<string, unknown>) => {
        capturedConflictConfig = config
        return { returning: vi.fn().mockResolvedValue(rows) }
      })
      const values = vi.fn().mockReturnValue({ onConflictDoNothing })
      databaseMock.db.insert = vi.fn().mockReturnValue({ values })
      return {
        values,
        onConflictDoNothing,
        getConflictConfig: () => capturedConflictConfig,
      }
    }

    /** Mock the select → from → where → limit chain used on the reuse path. */
    function mockSelectReturning(rows: SnapshotRow[]) {
      const limit = vi.fn().mockResolvedValue(rows)
      const where = vi.fn().mockReturnValue({ limit })
      const from = vi.fn().mockReturnValue({ where })
      databaseMock.db.select = vi.fn().mockReturnValue({ from })
      return databaseMock.db.select
    }

    it('inserts a new snapshot via onConflictDoNothing without a follow-up select', async () => {
      const service = new SnapshotService()
      const workflowId = 'wf-123'

      const { values } = mockInsertReturning([
        {
          id: 'generated-uuid-1',
          workflowId,
          stateHash: 'abc123',
          stateData: mockState,
          createdAt: new Date('2026-02-19T00:00:00Z'),
        },
      ])
      const select = mockSelectReturning([])

      const result = await service.createSnapshotWithDeduplication(workflowId, mockState)

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'generated-uuid-1', workflowId, stateData: mockState })
      )
      expect(result.snapshot.id).toBe('generated-uuid-1')
      expect(result.isNew).toBe(true)
      // New row returned by the insert → no extra read needed.
      expect(select).not.toHaveBeenCalled()
    })

    it('does NOT rewrite state_data on conflict (onConflictDoNothing, no set clause)', async () => {
      const service = new SnapshotService()
      const workflowId = 'wf-123'

      const { onConflictDoNothing, getConflictConfig } = mockInsertReturning([
        {
          id: 'generated-uuid-1',
          workflowId,
          stateHash: 'abc123',
          stateData: mockState,
          createdAt: new Date('2026-02-19T00:00:00Z'),
        },
      ])
      mockSelectReturning([])

      await service.createSnapshotWithDeduplication(workflowId, mockState)

      expect(onConflictDoNothing).toHaveBeenCalledTimes(1)
      const config = getConflictConfig()
      expect(config?.target).toBeDefined()
      // The whole point of this change: no SET clause, so the large jsonb is never rewritten.
      expect(config).not.toHaveProperty('set')
    })

    it('reuses the existing snapshot via a follow-up select when the insert no-ops', async () => {
      const service = new SnapshotService()
      const workflowId = 'wf-123'

      mockInsertReturning([]) // conflict → insert returns nothing
      const select = mockSelectReturning([
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
      expect(select).toHaveBeenCalledTimes(1)
    })

    it('does not throw on concurrent inserts with the same hash (loser falls back to select)', async () => {
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

      // First caller wins the insert; second caller's insert no-ops and selects.
      let insertCall = 0
      databaseMock.db.insert = vi.fn().mockImplementation(() => ({
        values: vi.fn().mockReturnValue({
          onConflictDoNothing: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(insertCall++ === 0 ? [newRow] : []),
          }),
        }),
      }))
      mockSelectReturning([existingRow])

      const [result1, result2] = await Promise.all([
        service.createSnapshotWithDeduplication(workflowId, mockState),
        service.createSnapshotWithDeduplication(workflowId, mockState),
      ])

      const byId = [result1, result2].sort((a, b) => a.snapshot.id.localeCompare(b.snapshot.id))
      expect(byId[0].snapshot.id).toBe('existing-snapshot-id')
      expect(byId[0].isNew).toBe(false)
      expect(byId[1].snapshot.id).toBe('generated-uuid-1')
      expect(byId[1].isNew).toBe(true)
    })

    it('throws a descriptive error when neither the insert nor the select yields a row', async () => {
      const service = new SnapshotService()
      const workflowId = 'wf-123'

      mockInsertReturning([])
      mockSelectReturning([])

      await expect(service.createSnapshotWithDeduplication(workflowId, mockState)).rejects.toThrow(
        /Failed to create or load execution snapshot/
      )
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

    it('returns 0 and skips delete when nothing is orphaned', async () => {
      const service = new SnapshotService()
      const { deleteFn } = setupCleanupMocks([])

      const count = await service.cleanupOrphanedSnapshots(7)

      expect(count).toBe(0)
      expect(deleteFn).not.toHaveBeenCalled()
    })

    it('stops after the first short batch', async () => {
      const service = new SnapshotService()
      const partial = Array.from({ length: 3 }, (_, i) => ({ id: `s${i}` }))
      const { deleteFn } = setupCleanupMocks([partial])

      const count = await service.cleanupOrphanedSnapshots(7)

      expect(count).toBe(3)
      expect(deleteFn).toHaveBeenCalledTimes(1)
    })

    it('loops through multiple full batches until exhausted', async () => {
      const service = new SnapshotService()
      const fullBatch = Array.from({ length: 1000 }, (_, i) => ({ id: `s${i}` }))
      const tail = [{ id: 'tail-1' }]
      const { deleteFn } = setupCleanupMocks([fullBatch, fullBatch, tail])

      const count = await service.cleanupOrphanedSnapshots(7)

      expect(count).toBe(2001)
      expect(deleteFn).toHaveBeenCalledTimes(3)
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
