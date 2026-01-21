/**
 * @vitest-environment node
 *
 * Database Helpers Unit Tests
 *
 * Tests for normalized table operations including loading, saving, and migrating
 * workflow data between JSON blob format and normalized database tables.
 */

import {
  createAgentBlock,
  createApiBlock,
  createBlock,
  createEdge,
  createLoopBlock,
  createParallelBlock,
  createStarterBlock,
  createWorkflowState,
  loggerMock,
} from '@sim/testing'
import { drizzleOrmMock } from '@sim/testing/mocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BlockState as AppBlockState,
  WorkflowState as AppWorkflowState,
} from '@/stores/workflows/workflow/types'

/**
 * Type helper for converting test workflow state to app workflow state.
 * This is needed because the testing package has slightly different types
 * for migration testing purposes.
 */
function asAppState<T>(state: T): AppWorkflowState {
  return state as unknown as AppWorkflowState
}

/**
 * Type helper for converting test blocks to app block state record.
 */
function asAppBlocks<T>(blocks: T): Record<string, AppBlockState> {
  return blocks as unknown as Record<string, AppBlockState>
}

/**
 * Type helper for creating subBlocks with legacy types for migration tests.
 * These tests intentionally use old SubBlockTypes (textarea, select, messages-input, input)
 * to verify the migration logic converts them to new types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function legacySubBlocks(subBlocks: Record<string, any>): any {
  return subBlocks
}

const { mockDb, mockWorkflowBlocks, mockWorkflowEdges, mockWorkflowSubflows } = vi.hoisted(() => {
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  }

  const mockWorkflowBlocks = {
    workflowId: 'workflowId',
    id: 'id',
    type: 'type',
    name: 'name',
    positionX: 'positionX',
    positionY: 'positionY',
    enabled: 'enabled',
    horizontalHandles: 'horizontalHandles',
    height: 'height',
    subBlocks: 'subBlocks',
    outputs: 'outputs',
    data: 'data',
    parentId: 'parentId',
    extent: 'extent',
  }

  const mockWorkflowEdges = {
    workflowId: 'workflowId',
    id: 'id',
    sourceBlockId: 'sourceBlockId',
    targetBlockId: 'targetBlockId',
    sourceHandle: 'sourceHandle',
    targetHandle: 'targetHandle',
  }

  const mockWorkflowSubflows = {
    workflowId: 'workflowId',
    id: 'id',
    type: 'type',
    config: 'config',
  }

  return { mockDb, mockWorkflowBlocks, mockWorkflowEdges, mockWorkflowSubflows }
})

vi.mock('@sim/db', () => ({
  db: mockDb,
  workflowBlocks: mockWorkflowBlocks,
  workflowEdges: mockWorkflowEdges,
  workflowSubflows: mockWorkflowSubflows,
  workflowDeploymentVersion: {
    id: 'id',
    workflowId: 'workflowId',
    version: 'version',
    state: 'state',
    isActive: 'isActive',
    createdAt: 'createdAt',
    createdBy: 'createdBy',
    deployedBy: 'deployedBy',
  },
  workflow: {},
  webhook: {},
}))

vi.mock('drizzle-orm', () => drizzleOrmMock)

vi.mock('@sim/logger', () => loggerMock)

import * as dbHelpers from '@/lib/workflows/persistence/utils'

const mockWorkflowId = 'test-workflow-123'

/**
 * Converts a BlockState to a mock database block row format.
 */
function toDbBlock(block: ReturnType<typeof createBlock>, workflowId: string) {
  return {
    id: block.id,
    workflowId,
    type: block.type,
    name: block.name,
    positionX: block.position.x,
    positionY: block.position.y,
    enabled: block.enabled,
    horizontalHandles: block.horizontalHandles,
    advancedMode: block.advancedMode ?? false,
    triggerMode: block.triggerMode ?? false,
    height: block.height ?? 150,
    subBlocks: block.subBlocks ?? {},
    outputs: block.outputs ?? {},
    data: block.data ?? {},
    parentId: block.data?.parentId ?? null,
    extent: block.data?.extent ?? null,
  }
}

const mockBlocksFromDb = [
  toDbBlock(
    createStarterBlock({
      id: 'block-1',
      name: 'Start Block',
      position: { x: 100, y: 100 },
      height: 150,
      subBlocks: { input: { id: 'input', type: 'short-input' as const, value: 'test' } },
      outputs: { result: { type: 'string' } },
      data: { parentId: undefined, extent: undefined, width: 350 },
    }),
    mockWorkflowId
  ),
  toDbBlock(
    createApiBlock({
      id: 'block-2',
      name: 'API Block',
      position: { x: 300, y: 100 },
      height: 200,
      parentId: 'loop-1',
    }),
    mockWorkflowId
  ),
  toDbBlock(
    createLoopBlock({
      id: 'loop-1',
      name: 'Loop Container',
      position: { x: 50, y: 50 },
      height: 250,
      data: { width: 500, height: 300, loopType: 'for', count: 5 },
    }),
    mockWorkflowId
  ),
  toDbBlock(
    createParallelBlock({
      id: 'parallel-1',
      name: 'Parallel Container',
      position: { x: 600, y: 50 },
      height: 250,
      data: { width: 500, height: 300, parallelType: 'count', count: 3 },
    }),
    mockWorkflowId
  ),
  toDbBlock(
    createApiBlock({
      id: 'block-3',
      name: 'Parallel Child',
      position: { x: 650, y: 150 },
      height: 200,
      parentId: 'parallel-1',
    }),
    mockWorkflowId
  ),
]

const mockEdgesFromDb = [
  {
    id: 'edge-1',
    workflowId: mockWorkflowId,
    sourceBlockId: 'block-1',
    targetBlockId: 'block-2',
    sourceHandle: 'output',
    targetHandle: 'input',
  },
]

const mockSubflowsFromDb = [
  {
    id: 'loop-1',
    workflowId: mockWorkflowId,
    type: 'loop',
    config: {
      id: 'loop-1',
      nodes: ['block-2'],
      iterations: 5,
      loopType: 'for',
    },
  },
  {
    id: 'parallel-1',
    workflowId: mockWorkflowId,
    type: 'parallel',
    config: {
      id: 'parallel-1',
      nodes: ['block-3'],
      distribution: ['item1', 'item2'],
    },
  },
]

const mockWorkflowState = createWorkflowState({
  blocks: {
    'block-1': createStarterBlock({
      id: 'block-1',
      name: 'Start Block',
      position: { x: 100, y: 100 },
      height: 150,
      subBlocks: { input: { id: 'input', type: 'short-input' as const, value: 'test' } },
      outputs: { result: { type: 'string' } },
      data: { width: 350 },
    }),
    'block-2': createApiBlock({
      id: 'block-2',
      name: 'API Block',
      position: { x: 300, y: 100 },
      height: 200,
      data: { parentId: 'loop-1', extent: 'parent' },
    }),
    'loop-1': createLoopBlock({
      id: 'loop-1',
      name: 'Loop Container',
      position: { x: 200, y: 50 },
      height: 250,
      data: { width: 500, height: 300, count: 5, loopType: 'for' },
    }),
    'parallel-1': createParallelBlock({
      id: 'parallel-1',
      name: 'Parallel Container',
      position: { x: 600, y: 50 },
      height: 250,
      data: { width: 500, height: 300, parallelType: 'count', count: 3 },
    }),
    'block-3': createApiBlock({
      id: 'block-3',
      name: 'Parallel Child',
      position: { x: 650, y: 150 },
      height: 180,
      data: { parentId: 'parallel-1', extent: 'parent' },
    }),
  },
  edges: [
    createEdge({
      id: 'edge-1',
      source: 'block-1',
      target: 'block-2',
      sourceHandle: 'output',
      targetHandle: 'input',
    }),
  ],
  loops: {
    'loop-1': {
      id: 'loop-1',
      nodes: ['block-2'],
      iterations: 5,
      loopType: 'for',
    },
  },
  parallels: {
    'parallel-1': {
      id: 'parallel-1',
      nodes: ['block-3'],
      distribution: ['item1', 'item2'],
    },
  },
})

describe('Database Helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('loadWorkflowFromNormalizedTables', () => {
    it('should successfully load workflow data from normalized tables', async () => {
      vi.clearAllMocks()

      let callCount = 0
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) {
              return Promise.resolve(mockBlocksFromDb)
            }
            if (callCount === 2) {
              return Promise.resolve(mockEdgesFromDb)
            }
            if (callCount === 3) {
              return Promise.resolve(mockSubflowsFromDb)
            }
            return Promise.resolve([])
          }),
        }),
      }))

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeDefined()
      expect(result?.isFromNormalizedTables).toBe(true)
      expect(result?.blocks).toBeDefined()
      expect(result?.edges).toBeDefined()
      expect(result?.loops).toBeDefined()
      expect(result?.parallels).toBeDefined()

      expect(result?.blocks['block-1']).toEqual({
        id: 'block-1',
        type: 'starter',
        name: 'Start Block',
        position: { x: 100, y: 100 },
        enabled: true,
        horizontalHandles: true,
        height: 150,
        subBlocks: { input: { id: 'input', type: 'short-input' as const, value: 'test' } },
        outputs: { result: { type: 'string' } },
        data: { parentId: undefined, extent: undefined, width: 350 },
        advancedMode: false,
        triggerMode: false,
      })

      expect(result?.edges[0]).toEqual({
        id: 'edge-1',
        source: 'block-1',
        target: 'block-2',
        sourceHandle: 'output',
        targetHandle: 'input',
        type: 'default',
        data: {},
      })

      expect(result?.loops['loop-1']).toEqual({
        id: 'loop-1',
        nodes: ['block-2'],
        iterations: 5,
        loopType: 'for',
        forEachItems: '',
        doWhileCondition: '',
        whileCondition: '',
        enabled: true,
      })

      expect(result?.parallels['parallel-1']).toEqual({
        id: 'parallel-1',
        nodes: ['block-3'],
        count: 5,
        distribution: ['item1', 'item2'],
        parallelType: 'count',
        enabled: true,
      })
    })

    it('should return null when no blocks are found', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeNull()
    })

    it('should return null when database query fails', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error('Database connection failed')),
        }),
      })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeNull()
    })

    it('should handle unknown subflow types gracefully', async () => {
      const subflowsWithUnknownType = [
        {
          id: 'unknown-1',
          workflowId: mockWorkflowId,
          type: 'unknown-type',
          config: { id: 'unknown-1' },
        },
      ]

      let callCount = 0
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve(mockBlocksFromDb)
            if (callCount === 2) return Promise.resolve(mockEdgesFromDb)
            if (callCount === 3) return Promise.resolve(subflowsWithUnknownType)
            return Promise.resolve([])
          }),
        }),
      })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeDefined()
      expect(result?.loops).toEqual({})
      expect(result?.parallels).toEqual({})
      expect(result?.blocks).toBeDefined()
      expect(result?.edges).toBeDefined()
    })

    it('should handle malformed database responses', async () => {
      const malformedBlocks = [
        toDbBlock(
          createBlock({
            id: 'block-1',
            type: null as any,
            name: null as any,
            position: { x: 0, y: 0 },
            height: 0,
          }),
          mockWorkflowId
        ),
      ]
      malformedBlocks[0].type = null as any
      malformedBlocks[0].name = null as any

      let callCount = 0
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve(malformedBlocks)
            if (callCount === 2) return Promise.resolve([])
            if (callCount === 3) return Promise.resolve([])
            return Promise.resolve([])
          }),
        }),
      })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeDefined()
      expect(result?.blocks['block-1']).toBeDefined()
      expect(result?.blocks['block-1'].type).toBeNull()
      expect(result?.blocks['block-1'].name).toBeNull()
    })

    it('should handle database connection errors gracefully', async () => {
      const connectionError = new Error('Connection refused')
      ;(connectionError as any).code = 'ECONNREFUSED'

      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(connectionError),
        }),
      })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeNull()
    })
  })

  describe('saveWorkflowToNormalizedTables', () => {
    it('should successfully save workflow data to normalized tables', async () => {
      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue([]),
          }),
        }
        return await callback(tx)
      })

      mockDb.transaction = mockTransaction

      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        asAppState(mockWorkflowState)
      )

      expect(result.success).toBe(true)

      expect(mockTransaction).toHaveBeenCalledTimes(1)
    })

    it('should handle empty workflow state gracefully', async () => {
      const emptyWorkflowState = createWorkflowState()

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue([]),
          }),
        }
        return await callback(tx)
      })

      mockDb.transaction = mockTransaction

      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        asAppState(emptyWorkflowState)
      )

      expect(result.success).toBe(true)
    })

    it('should return error when transaction fails', async () => {
      const mockTransaction = vi.fn().mockRejectedValue(new Error('Transaction failed'))
      mockDb.transaction = mockTransaction

      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        asAppState(mockWorkflowState)
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Transaction failed')
    })

    it('should handle database constraint errors', async () => {
      const constraintError = new Error('Unique constraint violation')
      ;(constraintError as any).code = '23505'

      const mockTransaction = vi.fn().mockRejectedValue(constraintError)
      mockDb.transaction = mockTransaction

      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        asAppState(mockWorkflowState)
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Unique constraint violation')
    })

    it('should properly format block data for database insertion', async () => {
      let capturedBlockInserts: any[] = []
      let capturedEdgeInserts: any[] = []
      let capturedSubflowInserts: any[] = []

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((data) => {
              if (data.length > 0) {
                if (data[0].positionX !== undefined) {
                  capturedBlockInserts = data
                } else if (data[0].sourceBlockId !== undefined) {
                  capturedEdgeInserts = data
                } else if (data[0].type === 'loop' || data[0].type === 'parallel') {
                  capturedSubflowInserts = data
                }
              }
              return Promise.resolve([])
            }),
          }),
        }
        return await callback(tx)
      })

      mockDb.transaction = mockTransaction

      await dbHelpers.saveWorkflowToNormalizedTables(mockWorkflowId, asAppState(mockWorkflowState))

      expect(capturedBlockInserts).toHaveLength(5)
      expect(capturedBlockInserts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'block-1',
            workflowId: mockWorkflowId,
            type: 'starter',
            name: 'Start Block',
            positionX: '100',
            positionY: '100',
            enabled: true,
            horizontalHandles: true,
            height: '150',
            parentId: null,
            extent: null,
          }),
          expect.objectContaining({
            id: 'loop-1',
            workflowId: mockWorkflowId,
            type: 'loop',
            parentId: null,
          }),
          expect.objectContaining({
            id: 'parallel-1',
            workflowId: mockWorkflowId,
            type: 'parallel',
            parentId: null,
          }),
        ])
      )

      expect(capturedEdgeInserts).toHaveLength(1)
      expect(capturedEdgeInserts[0]).toMatchObject({
        id: 'edge-1',
        workflowId: mockWorkflowId,
        sourceBlockId: 'block-1',
        targetBlockId: 'block-2',
        sourceHandle: 'output',
        targetHandle: 'input',
      })

      expect(capturedSubflowInserts).toHaveLength(2)
      expect(capturedSubflowInserts[0]).toMatchObject({
        id: 'loop-1',
        workflowId: mockWorkflowId,
        type: 'loop',
      })
    })

    it('should regenerate missing loop and parallel definitions from block data', async () => {
      let capturedSubflowInserts: any[] = []

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((data) => {
              if (data.length > 0 && (data[0].type === 'loop' || data[0].type === 'parallel')) {
                capturedSubflowInserts = data
              }
              return Promise.resolve([])
            }),
          }),
        }
        return await callback(tx)
      })

      mockDb.transaction = mockTransaction

      const staleWorkflowState = JSON.parse(JSON.stringify(mockWorkflowState))
      staleWorkflowState.loops = {}
      staleWorkflowState.parallels = {}

      await dbHelpers.saveWorkflowToNormalizedTables(mockWorkflowId, asAppState(staleWorkflowState))

      expect(capturedSubflowInserts).toHaveLength(2)
      expect(capturedSubflowInserts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'loop-1', type: 'loop' }),
          expect.objectContaining({ id: 'parallel-1', type: 'parallel' }),
        ])
      )
    })
  })

  describe('workflowExistsInNormalizedTables', () => {
    it('should return true when workflow exists in normalized tables', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 'block-1' }]),
          }),
        }),
      })

      const result = await dbHelpers.workflowExistsInNormalizedTables(mockWorkflowId)

      expect(result).toBe(true)
    })

    it('should return false when workflow does not exist in normalized tables', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      })

      const result = await dbHelpers.workflowExistsInNormalizedTables(mockWorkflowId)

      expect(result).toBe(false)
    })

    it('should return false when database query fails', async () => {
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('Database error')),
          }),
        }),
      })

      const result = await dbHelpers.workflowExistsInNormalizedTables(mockWorkflowId)

      expect(result).toBe(false)
    })
  })

  describe('error handling and edge cases', () => {
    it('should handle very large workflow data', async () => {
      const blocks: Record<string, ReturnType<typeof createBlock>> = {}
      const edges: ReturnType<typeof createEdge>[] = []

      for (let i = 0; i < 1000; i++) {
        blocks[`block-${i}`] = createApiBlock({
          id: `block-${i}`,
          name: `Block ${i}`,
          position: { x: i * 100, y: i * 100 },
        })
      }

      for (let i = 0; i < 999; i++) {
        edges.push(
          createEdge({
            id: `edge-${i}`,
            source: `block-${i}`,
            target: `block-${i + 1}`,
          })
        )
      }

      const largeWorkflowState = createWorkflowState({ blocks, edges })

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue([]),
          }),
        }
        return await callback(tx)
      })

      mockDb.transaction = mockTransaction

      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        asAppState(largeWorkflowState)
      )

      expect(result.success).toBe(true)
    })
  })

  describe('advancedMode persistence', () => {
    it('should load advancedMode property from database', async () => {
      const testBlocks = [
        toDbBlock(
          createAgentBlock({
            id: 'block-advanced',
            name: 'Advanced Block',
            position: { x: 100, y: 100 },
            height: 200,
            advancedMode: true,
          }),
          mockWorkflowId
        ),
        toDbBlock(
          createAgentBlock({
            id: 'block-basic',
            name: 'Basic Block',
            position: { x: 200, y: 100 },
            height: 150,
            advancedMode: false,
          }),
          mockWorkflowId
        ),
      ]
      testBlocks[0].advancedMode = true
      testBlocks[1].advancedMode = false

      vi.clearAllMocks()

      let callCount = 0
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve(testBlocks)
            if (callCount === 2) return Promise.resolve([])
            if (callCount === 3) return Promise.resolve([])
            return Promise.resolve([])
          }),
        }),
      }))

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeDefined()

      const advancedBlock = result?.blocks['block-advanced']
      expect(advancedBlock?.advancedMode).toBe(true)

      const basicBlock = result?.blocks['block-basic']
      expect(basicBlock?.advancedMode).toBe(false)
    })

    it('should handle default values for boolean fields consistently', async () => {
      const blocksWithDefaultValues = [
        toDbBlock(
          createAgentBlock({
            id: 'block-with-defaults',
            name: 'Block with default values',
            position: { x: 100, y: 100 },
            height: 150,
          }),
          mockWorkflowId
        ),
      ]

      vi.clearAllMocks()

      let callCount = 0
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve(blocksWithDefaultValues)
            return Promise.resolve([])
          }),
        }),
      }))

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeDefined()

      const defaultsBlock = result?.blocks['block-with-defaults']
      expect(defaultsBlock?.advancedMode).toBe(false)
      expect(defaultsBlock?.triggerMode).toBe(false)
    })
  })

  describe('end-to-end advancedMode persistence verification', () => {
    it('should persist advancedMode through complete duplication and save cycle', async () => {
      const originalBlock = toDbBlock(
        createAgentBlock({
          id: 'agent-original',
          name: 'Agent 1',
          position: { x: 100, y: 100 },
          height: 200,
          advancedMode: true,
          subBlocks: {
            systemPrompt: {
              id: 'systemPrompt',
              type: 'long-input',
              value: 'You are a helpful assistant',
            },
            userPrompt: { id: 'userPrompt', type: 'long-input', value: 'Help the user' },
            model: { id: 'model', type: 'dropdown', value: 'gpt-4o' },
          },
        }),
        mockWorkflowId
      )
      originalBlock.advancedMode = true

      const duplicatedBlock = toDbBlock(
        createAgentBlock({
          id: 'agent-duplicate',
          name: 'Agent 2',
          position: { x: 200, y: 100 },
          height: 200,
          advancedMode: true,
          subBlocks: {
            systemPrompt: {
              id: 'systemPrompt',
              type: 'long-input',
              value: 'You are a helpful assistant',
            },
            userPrompt: { id: 'userPrompt', type: 'long-input', value: 'Help the user' },
            model: { id: 'model', type: 'dropdown', value: 'gpt-4o' },
          },
        }),
        mockWorkflowId
      )
      duplicatedBlock.advancedMode = true

      vi.clearAllMocks()

      let callCount = 0
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve([originalBlock, duplicatedBlock])
            if (callCount === 2) return Promise.resolve([])
            if (callCount === 3) return Promise.resolve([])
            return Promise.resolve([])
          }),
        }),
      }))

      const loadedState = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)
      expect(loadedState).toBeDefined()
      expect(loadedState?.blocks['agent-original'].advancedMode).toBe(true)
      expect(loadedState?.blocks['agent-duplicate'].advancedMode).toBe(true)

      const workflowState = {
        blocks: loadedState!.blocks,
        edges: loadedState!.edges,
        loops: {},
        parallels: {},
        deploymentStatuses: {},
      }

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
          insert: vi.fn().mockImplementation((_table) => ({
            values: vi.fn().mockImplementation((values) => {
              if (Array.isArray(values)) {
                values.forEach((blockInsert) => {
                  if (blockInsert.id === 'agent-original') {
                    expect(blockInsert.advancedMode).toBe(true)
                  }
                  if (blockInsert.id === 'agent-duplicate') {
                    expect(blockInsert.advancedMode).toBe(true)
                  }
                })
              }
              return Promise.resolve()
            }),
          })),
        }
        return await callback(mockTx)
      })

      mockDb.transaction = mockTransaction

      const saveResult = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        workflowState
      )
      expect(saveResult.success).toBe(true)

      expect(mockTransaction).toHaveBeenCalled()
    })

    it('should handle mixed advancedMode states correctly', async () => {
      const basicBlock = toDbBlock(
        createAgentBlock({
          id: 'agent-basic',
          name: 'Basic Agent',
          position: { x: 100, y: 100 },
          height: 150,
          advancedMode: false,
          subBlocks: legacySubBlocks({ model: { id: 'model', type: 'select', value: 'gpt-4o' } }),
        }),
        mockWorkflowId
      )

      const advancedBlock = toDbBlock(
        createAgentBlock({
          id: 'agent-advanced',
          name: 'Advanced Agent',
          position: { x: 200, y: 100 },
          height: 200,
          advancedMode: true,
          subBlocks: legacySubBlocks({
            systemPrompt: { id: 'systemPrompt', type: 'textarea', value: 'System prompt' },
            userPrompt: { id: 'userPrompt', type: 'textarea', value: 'User prompt' },
            model: { id: 'model', type: 'select', value: 'gpt-4o' },
          }),
        }),
        mockWorkflowId
      )
      advancedBlock.advancedMode = true

      vi.clearAllMocks()

      let callCount = 0
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve([basicBlock, advancedBlock])
            return Promise.resolve([])
          }),
        }),
      }))

      const loadedState = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)
      expect(loadedState).toBeDefined()

      expect(loadedState?.blocks['agent-basic'].advancedMode).toBe(false)
      expect(loadedState?.blocks['agent-advanced'].advancedMode).toBe(true)
    })

    it('should preserve advancedMode during workflow state round-trip', async () => {
      const testWorkflowState = createWorkflowState({
        blocks: {
          'block-1': createAgentBlock({
            id: 'block-1',
            name: 'Test Agent',
            position: { x: 100, y: 100 },
            height: 200,
            advancedMode: true,
            subBlocks: {
              systemPrompt: { id: 'systemPrompt', type: 'long-input' as const, value: 'System' },
              model: { id: 'model', type: 'dropdown' as const, value: 'gpt-4o' },
            },
          }),
        },
      })

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(undefined),
          }),
        }
        return await callback(mockTx)
      })

      mockDb.transaction = mockTransaction

      const saveResult = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        asAppState(testWorkflowState)
      )
      expect(saveResult.success).toBe(true)

      vi.clearAllMocks()
      let callCount = 0
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) {
              return Promise.resolve([
                {
                  id: 'block-1',
                  workflowId: mockWorkflowId,
                  type: 'agent',
                  name: 'Test Agent',
                  positionX: 100,
                  positionY: 100,
                  enabled: true,
                  horizontalHandles: true,
                  advancedMode: true,
                  height: 200,
                  subBlocks: {
                    systemPrompt: { id: 'systemPrompt', type: 'textarea', value: 'System' },
                    model: { id: 'model', type: 'select', value: 'gpt-4o' },
                  },
                  outputs: {},
                  data: {},
                  parentId: null,
                  extent: null,
                },
              ])
            }
            return Promise.resolve([])
          }),
        }),
      }))

      const loadedState = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)
      expect(loadedState).toBeDefined()
      expect(loadedState?.blocks['block-1'].advancedMode).toBe(true)
    })
  })

  describe('migrateAgentBlocksToMessagesFormat', () => {
    it('should migrate agent block with both systemPrompt and userPrompt', () => {
      const blocks = {
        'agent-1': createAgentBlock({
          id: 'agent-1',
          name: 'Test Agent',
          subBlocks: legacySubBlocks({
            systemPrompt: {
              id: 'systemPrompt',
              type: 'textarea',
              value: 'You are a helpful assistant',
            },
            userPrompt: {
              id: 'userPrompt',
              type: 'textarea',
              value: 'Hello world',
            },
          }),
        }),
      }

      const migrated = dbHelpers.migrateAgentBlocksToMessagesFormat(asAppBlocks(blocks))

      expect(migrated['agent-1'].subBlocks.messages).toBeDefined()
      expect(migrated['agent-1'].subBlocks.messages?.value).toEqual([
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello world' },
      ])
      expect(migrated['agent-1'].subBlocks.systemPrompt).toBeDefined()
      expect(migrated['agent-1'].subBlocks.userPrompt).toBeDefined()
    })

    it('should migrate agent block with only systemPrompt', () => {
      const blocks = {
        'agent-1': createAgentBlock({
          id: 'agent-1',
          subBlocks: legacySubBlocks({
            systemPrompt: {
              id: 'systemPrompt',
              type: 'textarea',
              value: 'You are helpful',
            },
          }),
        }),
      }

      const migrated = dbHelpers.migrateAgentBlocksToMessagesFormat(asAppBlocks(blocks))

      expect(migrated['agent-1'].subBlocks.messages?.value).toEqual([
        { role: 'system', content: 'You are helpful' },
      ])
    })

    it('should migrate agent block with only userPrompt', () => {
      const blocks = {
        'agent-1': createAgentBlock({
          id: 'agent-1',
          subBlocks: legacySubBlocks({
            userPrompt: {
              id: 'userPrompt',
              type: 'textarea',
              value: 'Hello',
            },
          }),
        }),
      }

      const migrated = dbHelpers.migrateAgentBlocksToMessagesFormat(asAppBlocks(blocks))

      expect(migrated['agent-1'].subBlocks.messages?.value).toEqual([
        { role: 'user', content: 'Hello' },
      ])
    })

    it('should handle userPrompt as object with input field', () => {
      const blocks = {
        'agent-1': createAgentBlock({
          id: 'agent-1',
          subBlocks: legacySubBlocks({
            userPrompt: {
              id: 'userPrompt',
              type: 'textarea',
              value: { input: 'Hello from object' },
            },
          }),
        }),
      }

      const migrated = dbHelpers.migrateAgentBlocksToMessagesFormat(asAppBlocks(blocks))

      expect(migrated['agent-1'].subBlocks.messages?.value).toEqual([
        { role: 'user', content: 'Hello from object' },
      ])
    })

    it('should stringify userPrompt object without input field', () => {
      const blocks = {
        'agent-1': createAgentBlock({
          id: 'agent-1',
          subBlocks: legacySubBlocks({
            userPrompt: {
              id: 'userPrompt',
              type: 'textarea',
              value: { foo: 'bar', baz: 123 },
            },
          }),
        }),
      }

      const migrated = dbHelpers.migrateAgentBlocksToMessagesFormat(asAppBlocks(blocks))

      expect(migrated['agent-1'].subBlocks.messages?.value).toEqual([
        { role: 'user', content: '{"foo":"bar","baz":123}' },
      ])
    })

    it('should not migrate if messages array already exists', () => {
      const existingMessages = [{ role: 'user', content: 'Existing message' }]
      const blocks = {
        'agent-1': createAgentBlock({
          id: 'agent-1',
          subBlocks: legacySubBlocks({
            systemPrompt: {
              id: 'systemPrompt',
              type: 'textarea',
              value: 'Old system',
            },
            userPrompt: {
              id: 'userPrompt',
              type: 'textarea',
              value: 'Old user',
            },
            messages: {
              id: 'messages',
              type: 'messages-input',
              value: existingMessages,
            },
          }),
        }),
      }

      const migrated = dbHelpers.migrateAgentBlocksToMessagesFormat(asAppBlocks(blocks))

      expect(migrated['agent-1'].subBlocks.messages?.value).toEqual(existingMessages)
    })

    it('should not migrate if no old format prompts exist', () => {
      const blocks = {
        'agent-1': createAgentBlock({
          id: 'agent-1',
          subBlocks: legacySubBlocks({
            model: {
              id: 'model',
              type: 'select',
              value: 'gpt-4o',
            },
          }),
        }),
      }

      const migrated = dbHelpers.migrateAgentBlocksToMessagesFormat(asAppBlocks(blocks))

      expect(migrated['agent-1'].subBlocks.messages).toBeUndefined()
    })

    it('should handle non-agent blocks without modification', () => {
      const blocks = {
        'api-1': createApiBlock({
          id: 'api-1',
          subBlocks: legacySubBlocks({
            url: {
              id: 'url',
              type: 'input',
              value: 'https://example.com',
            },
          }),
        }),
      }

      const migrated = dbHelpers.migrateAgentBlocksToMessagesFormat(asAppBlocks(blocks))

      expect(migrated['api-1']).toEqual(blocks['api-1'])
      expect(migrated['api-1'].subBlocks.messages).toBeUndefined()
    })

    it('should handle multiple blocks with mixed types', () => {
      const blocks = {
        'agent-1': createAgentBlock({
          id: 'agent-1',
          subBlocks: legacySubBlocks({
            systemPrompt: { id: 'systemPrompt', type: 'textarea', value: 'System 1' },
          }),
        }),
        'api-1': createApiBlock({
          id: 'api-1',
        }),
        'agent-2': createAgentBlock({
          id: 'agent-2',
          subBlocks: legacySubBlocks({
            userPrompt: { id: 'userPrompt', type: 'textarea', value: 'User 2' },
          }),
        }),
      }

      const migrated = dbHelpers.migrateAgentBlocksToMessagesFormat(asAppBlocks(blocks))

      expect(migrated['agent-1'].subBlocks.messages?.value).toEqual([
        { role: 'system', content: 'System 1' },
      ])

      expect(migrated['api-1']).toEqual(blocks['api-1'])

      expect(migrated['agent-2'].subBlocks.messages?.value).toEqual([
        { role: 'user', content: 'User 2' },
      ])
    })

    it('should handle empty string prompts by not migrating', () => {
      const blocks = {
        'agent-1': createAgentBlock({
          id: 'agent-1',
          subBlocks: legacySubBlocks({
            systemPrompt: { id: 'systemPrompt', type: 'textarea', value: '' },
            userPrompt: { id: 'userPrompt', type: 'textarea', value: '' },
          }),
        }),
      }

      const migrated = dbHelpers.migrateAgentBlocksToMessagesFormat(asAppBlocks(blocks))

      expect(migrated['agent-1'].subBlocks.messages).toBeUndefined()
    })

    it('should handle numeric prompt values by converting to string', () => {
      const blocks = {
        'agent-1': createAgentBlock({
          id: 'agent-1',
          subBlocks: legacySubBlocks({
            systemPrompt: { id: 'systemPrompt', type: 'textarea', value: 123 },
          }),
        }),
      }

      const migrated = dbHelpers.migrateAgentBlocksToMessagesFormat(asAppBlocks(blocks))

      expect(migrated['agent-1'].subBlocks.messages?.value).toEqual([
        { role: 'system', content: '123' },
      ])
    })

    it('should be idempotent - running twice should not double migrate', () => {
      const blocks = {
        'agent-1': createAgentBlock({
          id: 'agent-1',
          subBlocks: legacySubBlocks({
            systemPrompt: { id: 'systemPrompt', type: 'textarea', value: 'System' },
          }),
        }),
      }

      const migrated1 = dbHelpers.migrateAgentBlocksToMessagesFormat(asAppBlocks(blocks))
      const messages1 = migrated1['agent-1'].subBlocks.messages?.value

      const migrated2 = dbHelpers.migrateAgentBlocksToMessagesFormat(migrated1)
      const messages2 = migrated2['agent-1'].subBlocks.messages?.value

      expect(messages2).toEqual(messages1)
      expect(messages2).toEqual([{ role: 'system', content: 'System' }])
    })
  })
})
