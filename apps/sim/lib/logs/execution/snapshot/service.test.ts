/**
 * @vitest-environment node
 */
import { databaseMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbOrTx } from '@/lib/db/types'

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'generated-uuid-1'),
  generateShortId: vi.fn(() => 'generated-short-1'),
  isValidUuid: vi.fn((v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  ),
}))

import {
  MAX_WORKFLOW_EXECUTION_SNAPSHOT_BYTES,
  SnapshotService,
} from '@/lib/logs/execution/snapshot/service'
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

      expect(hash1).toBe(hash2)
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
    type SnapshotInsert = Omit<SnapshotRow, 'createdAt'>

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

    it('inserts a new snapshot in a single atomic upsert', async () => {
      const service = new SnapshotService()
      const workflowId = 'wf-123'

      const { values } = mockUpsertReturning([
        {
          id: 'generated-uuid-1',
          workflowId,
          stateHash: 'abc123',
          stateData: mockState,
          createdAt: new Date('2026-02-19T00:00:00Z'),
        },
      ])

      const result = await service.createSnapshotWithDeduplication(workflowId, mockState)

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'generated-uuid-1', workflowId, stateData: mockState })
      )
      expect(result.snapshot.id).toBe('generated-uuid-1')
      expect(result.isNew).toBe(true)
      // Single atomic statement — never a follow-up select (which would race with cleanup).
      expect(databaseMock.db.select).not.toHaveBeenCalled()
    })

    it('uses the supplied transaction executor', async () => {
      const service = new SnapshotService()
      const workflowId = 'wf-123'
      const returning = vi.fn().mockResolvedValue([
        {
          id: 'generated-uuid-1',
          workflowId,
          stateHash: 'abc123',
          stateData: mockState,
          createdAt: new Date('2026-02-19T00:00:00Z'),
        },
      ])
      const transaction = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockReturnValue({ returning }),
          }),
        }),
      } as unknown as DbOrTx

      const result = await service.createSnapshotWithDeduplication(
        workflowId,
        mockState,
        transaction
      )

      expect(transaction.insert).toHaveBeenCalled()
      expect(databaseMock.db.insert).not.toHaveBeenCalled()
      expect(result.snapshot.id).toBe('generated-uuid-1')
    })

    it('fails when the atomic upsert returns no snapshot', async () => {
      const service = new SnapshotService()
      mockUpsertReturning([])

      await expect(service.createSnapshotWithDeduplication('wf-123', mockState)).rejects.toThrow(
        'Failed to create workflow snapshot for workflow wf-123'
      )
    })

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

    it('does not deduplicate output-only changes in exact mode', async () => {
      const service = new SnapshotService()
      const workflowId = 'wf-123'
      const changedState = structuredClone(mockState)
      changedState.blocks.block1.outputs = {
        response: { type: 'number', description: 'Changed output' },
      }
      const inserted: SnapshotInsert[] = []
      const values = vi.fn().mockImplementation((snapshotData: SnapshotInsert) => {
        inserted.push(snapshotData)
        return {
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValue([{ ...snapshotData, createdAt: new Date('2026-02-19') }]),
          }),
        }
      })
      databaseMock.db.insert = vi.fn().mockReturnValue({ values })

      await service.createExactSnapshotWithDeduplication(workflowId, mockState)
      await service.createExactSnapshotWithDeduplication(workflowId, changedState)

      expect(inserted).toHaveLength(2)
      expect(inserted[0]?.stateHash).not.toBe(inserted[1]?.stateHash)
    })

    it('fails fast if a hash conflict returns different stored state', async () => {
      const service = new SnapshotService()
      const workflowId = 'wf-123'
      const mismatchedState: WorkflowState = {
        ...mockState,
        blocks: {
          block1: {
            ...mockState.blocks.block1,
            outputs: { changed: { type: 'number' } },
          },
        },
      }

      mockUpsertReturning([
        {
          id: 'existing-snapshot-id',
          workflowId,
          stateHash: service.computeExactStateHash(mockState),
          stateData: mismatchedState,
          createdAt: new Date('2026-02-19T00:00:00Z'),
        },
      ])

      await expect(
        service.createExactSnapshotWithDeduplication(workflowId, mockState)
      ).rejects.toThrow('hash collision returned mismatched state')
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

  describe('getBoundedSnapshotForWorkflow', () => {
    function selectChain(rows: unknown[]) {
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(rows),
          }),
        }),
      }
    }

    function mockBoundedSnapshotQueries(params: {
      workflowId?: string | null
      stateBytes?: number
      stateHash?: string
      stateData?: unknown
    }) {
      const service = new SnapshotService()
      const workflowId = params.workflowId === undefined ? 'wf-123' : params.workflowId
      const stateData = params.stateData ?? mockState
      const stateHash = params.stateHash ?? service.computeExactStateHash(mockState)
      databaseMock.db.select = vi
        .fn()
        .mockReturnValueOnce(
          selectChain([
            {
              workflowId,
              stateHash,
              stateBytes: params.stateBytes ?? 1_024,
            },
          ])
        )
        .mockReturnValueOnce(
          selectChain([
            {
              id: 'snapshot-1',
              workflowId,
              stateHash,
              stateData,
              createdAt: new Date('2026-02-19T00:00:00Z'),
            },
          ])
        )
      return service
    }

    it('preflights bytes and returns a workflow-owned hash-validated snapshot', async () => {
      const service = mockBoundedSnapshotQueries({})

      const snapshot = await service.getBoundedSnapshotForWorkflow('snapshot-1', 'wf-123')

      expect(snapshot).toMatchObject({
        id: 'snapshot-1',
        workflowId: 'wf-123',
        stateData: mockState,
        createdAt: '2026-02-19T00:00:00.000Z',
      })
      expect(databaseMock.db.select).toHaveBeenCalledTimes(2)
    })

    it('rejects snapshots written with the semantic logging hash', async () => {
      const legacyHash = new SnapshotService().computeStateHash(mockState)
      const service = mockBoundedSnapshotQueries({ stateHash: legacyHash })

      await expect(service.getBoundedSnapshotForWorkflow('snapshot-1', 'wf-123')).rejects.toThrow(
        'failed state hash validation'
      )
    })

    it('rejects oversized state before the materialization query', async () => {
      const service = mockBoundedSnapshotQueries({
        stateBytes: MAX_WORKFLOW_EXECUTION_SNAPSHOT_BYTES + 1,
      })

      await expect(service.getBoundedSnapshotForWorkflow('snapshot-1', 'wf-123')).rejects.toThrow(
        `exceeds ${MAX_WORKFLOW_EXECUTION_SNAPSHOT_BYTES} serialized bytes`
      )
      expect(databaseMock.db.select).toHaveBeenCalledTimes(1)
    })

    it('rejects a snapshot owned by another workflow before materialization', async () => {
      const service = mockBoundedSnapshotQueries({ workflowId: 'wf-other' })

      await expect(service.getBoundedSnapshotForWorkflow('snapshot-1', 'wf-123')).rejects.toThrow(
        'does not belong to workflow wf-123'
      )
      expect(databaseMock.db.select).toHaveBeenCalledTimes(1)
    })

    it('rejects invalid workflow state and state hash mismatches', async () => {
      const invalidStateService = mockBoundedSnapshotQueries({
        stateHash: '0'.repeat(64),
        stateData: {},
      })
      await expect(
        invalidStateService.getBoundedSnapshotForWorkflow('snapshot-1', 'wf-123')
      ).rejects.toThrow('contains invalid workflow state')

      const mismatchedHashService = mockBoundedSnapshotQueries({
        stateHash: '0'.repeat(64),
      })
      await expect(
        mismatchedHashService.getBoundedSnapshotForWorkflow('snapshot-1', 'wf-123')
      ).rejects.toThrow('failed state hash validation')
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
