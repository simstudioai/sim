/**
 * @vitest-environment node
 */
import { databaseMock, drizzleOrmMock, loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => databaseMock)
vi.mock('@sim/db/schema', () => ({}))
vi.mock('@sim/logger', () => loggerMock)
vi.mock('drizzle-orm', () => drizzleOrmMock)
vi.mock('uuid', () => ({ v4: vi.fn(() => 'generated-uuid-1') }))

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
    it('should use upsert to insert a new snapshot', async () => {
      const service = new SnapshotService()
      const workflowId = 'wf-123'

      const mockReturning = vi.fn().mockResolvedValue([
        {
          id: 'generated-uuid-1',
          workflowId,
          stateHash: 'abc123',
          stateData: mockState,
          createdAt: new Date('2026-02-19T00:00:00Z'),
        },
      ])
      const mockOnConflictDoUpdate = vi.fn().mockReturnValue({ returning: mockReturning })
      const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate })
      const mockInsert = vi.fn().mockReturnValue({ values: mockValues })
      databaseMock.db.insert = mockInsert

      const result = await service.createSnapshotWithDeduplication(workflowId, mockState)

      expect(mockInsert).toHaveBeenCalled()
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'generated-uuid-1',
          workflowId,
          stateData: mockState,
        })
      )
      expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          set: expect.any(Object),
        })
      )
      expect(result.snapshot.id).toBe('generated-uuid-1')
      expect(result.isNew).toBe(true)
    })

    it('should detect reused snapshot when returned id differs from generated id', async () => {
      const service = new SnapshotService()
      const workflowId = 'wf-123'

      const mockReturning = vi.fn().mockResolvedValue([
        {
          id: 'existing-snapshot-id',
          workflowId,
          stateHash: 'abc123',
          stateData: mockState,
          createdAt: new Date('2026-02-19T00:00:00Z'),
        },
      ])
      const mockOnConflictDoUpdate = vi.fn().mockReturnValue({ returning: mockReturning })
      const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate })
      const mockInsert = vi.fn().mockReturnValue({ values: mockValues })
      databaseMock.db.insert = mockInsert

      const result = await service.createSnapshotWithDeduplication(workflowId, mockState)

      expect(result.snapshot.id).toBe('existing-snapshot-id')
      expect(result.isNew).toBe(false)
    })

    it('should not throw on concurrent inserts with the same hash', async () => {
      const service = new SnapshotService()
      const workflowId = 'wf-123'

      const mockReturningNew = vi.fn().mockResolvedValue([
        {
          id: 'generated-uuid-1',
          workflowId,
          stateHash: 'abc123',
          stateData: mockState,
          createdAt: new Date('2026-02-19T00:00:00Z'),
        },
      ])
      const mockReturningExisting = vi.fn().mockResolvedValue([
        {
          id: 'existing-snapshot-id',
          workflowId,
          stateHash: 'abc123',
          stateData: mockState,
          createdAt: new Date('2026-02-19T00:00:00Z'),
        },
      ])

      let callCount = 0
      databaseMock.db.insert = vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation(() => ({
          onConflictDoUpdate: vi.fn().mockImplementation(() => ({
            returning: callCount++ === 0 ? mockReturningNew : mockReturningExisting,
          })),
        })),
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

    it('should pass state_data in the ON CONFLICT SET clause', async () => {
      const service = new SnapshotService()
      const workflowId = 'wf-123'

      let capturedConflictConfig: Record<string, unknown> | undefined
      const mockReturning = vi.fn().mockResolvedValue([
        {
          id: 'generated-uuid-1',
          workflowId,
          stateHash: 'abc123',
          stateData: mockState,
          createdAt: new Date('2026-02-19T00:00:00Z'),
        },
      ])

      databaseMock.db.insert = vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockImplementation((config: Record<string, unknown>) => {
            capturedConflictConfig = config
            return { returning: mockReturning }
          }),
        }),
      })

      await service.createSnapshotWithDeduplication(workflowId, mockState)

      expect(capturedConflictConfig).toBeDefined()
      expect(capturedConflictConfig!.target).toBeDefined()
      expect(capturedConflictConfig!.set).toBeDefined()
      expect(capturedConflictConfig!.set).toHaveProperty('stateData')
    })

    it('should always call insert, never a separate select for deduplication', async () => {
      const service = new SnapshotService()
      const workflowId = 'wf-123'

      const mockReturning = vi.fn().mockResolvedValue([
        {
          id: 'generated-uuid-1',
          workflowId,
          stateHash: 'abc123',
          stateData: mockState,
          createdAt: new Date('2026-02-19T00:00:00Z'),
        },
      ])
      const mockOnConflictDoUpdate = vi.fn().mockReturnValue({ returning: mockReturning })
      const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate })
      databaseMock.db.insert = vi.fn().mockReturnValue({ values: mockValues })
      databaseMock.db.select = vi.fn()

      await service.createSnapshotWithDeduplication(workflowId, mockState)

      expect(databaseMock.db.insert).toHaveBeenCalledTimes(1)
      expect(databaseMock.db.select).not.toHaveBeenCalled()
    })
  })
})
