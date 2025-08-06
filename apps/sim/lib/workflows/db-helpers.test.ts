/**
 * @vitest-environment node
 *
 * Database Helpers Unit Tests
 *
 * Tests for normalized table operations including loading, saving, and migrating
 * workflow data between JSON blob format and normalized database tables.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

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
  isWide: 'isWide',
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

vi.doMock('@/db', () => ({
  db: mockDb,
}))

vi.doMock('@/db/schema', () => ({
  workflowBlocks: mockWorkflowBlocks,
  workflowEdges: mockWorkflowEdges,
  workflowSubflows: mockWorkflowSubflows,
}))

vi.doMock('drizzle-orm', () => ({
  eq: vi.fn((field, value) => ({ field, value, type: 'eq' })),
}))

vi.doMock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

const mockWorkflowId = 'test-workflow-123'

const mockBlocksFromDb = [
  {
    id: 'block-1',
    workflowId: mockWorkflowId,
    type: 'starter',
    name: 'Start Block',
    positionX: 100,
    positionY: 100,
    enabled: true,
    horizontalHandles: true,
    isWide: false,
    height: 150,
    subBlocks: { input: { id: 'input', type: 'short-input' as const, value: 'test' } },
    outputs: { result: { type: 'string' } },
    data: { parentId: null, extent: null, width: 350 },
    parentId: null,
    extent: null,
  },
  {
    id: 'block-2',
    workflowId: mockWorkflowId,
    type: 'api',
    name: 'API Block',
    positionX: 300,
    positionY: 100,
    enabled: true,
    horizontalHandles: true,
    isWide: true,
    height: 200,
    subBlocks: {},
    outputs: {},
    data: { parentId: 'loop-1', extent: 'parent' },
    parentId: 'loop-1',
    extent: 'parent',
  },
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

const mockWorkflowState: WorkflowState = {
  blocks: {
    'block-1': {
      id: 'block-1',
      type: 'starter',
      name: 'Start Block',
      position: { x: 100, y: 100 },
      subBlocks: { input: { id: 'input', type: 'short-input' as const, value: 'test' } },
      outputs: { result: { type: 'string' } },
      enabled: true,
      horizontalHandles: true,
      isWide: false,
      height: 150,
      data: { width: 350 },
    },
    'block-2': {
      id: 'block-2',
      type: 'api',
      name: 'API Block',
      position: { x: 300, y: 100 },
      subBlocks: {},
      outputs: {},
      enabled: true,
      horizontalHandles: true,
      isWide: true,
      height: 200,
      data: { parentId: 'loop-1', extent: 'parent' },
    },
  },
  edges: [
    {
      id: 'edge-1',
      source: 'block-1',
      target: 'block-2',
      sourceHandle: 'output',
      targetHandle: 'input',
    },
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
  lastSaved: Date.now(),
  isDeployed: false,
  deploymentStatuses: {},
  hasActiveWebhook: false,
}

describe('Database Helpers', () => {
  let dbHelpers: typeof import('@/lib/workflows/db-helpers')

  beforeEach(async () => {
    vi.clearAllMocks()
    dbHelpers = await import('@/lib/workflows/db-helpers')
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

      // Verify blocks are transformed correctly
      expect(result?.blocks['block-1']).toEqual({
        id: 'block-1',
        type: 'starter',
        name: 'Start Block',
        position: { x: 100, y: 100 },
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        height: 150,
        subBlocks: { input: { id: 'input', type: 'short-input' as const, value: 'test' } },
        outputs: { result: { type: 'string' } },
        data: { parentId: null, extent: null, width: 350 },
        parentId: null,
        extent: null,
      })

      // Verify edges are transformed correctly
      expect(result?.edges[0]).toEqual({
        id: 'edge-1',
        source: 'block-1',
        target: 'block-2',
        sourceHandle: 'output',
        targetHandle: 'input',
      })

      // Verify loops are transformed correctly
      expect(result?.loops['loop-1']).toEqual({
        id: 'loop-1',
        nodes: ['block-2'],
        iterations: 5,
        loopType: 'for',
      })

      // Verify parallels are transformed correctly
      expect(result?.parallels['parallel-1']).toEqual({
        id: 'parallel-1',
        nodes: ['block-3'],
        distribution: ['item1', 'item2'],
      })
    })

    it('should return null when no blocks are found', async () => {
      // Mock empty results from all queries
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeNull()
    })

    it('should return null when database query fails', async () => {
      // Mock database error
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

      // Mock the database queries properly
      let callCount = 0
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve(mockBlocksFromDb) // blocks query
            if (callCount === 2) return Promise.resolve(mockEdgesFromDb) // edges query
            if (callCount === 3) return Promise.resolve(subflowsWithUnknownType) // subflows query
            return Promise.resolve([])
          }),
        }),
      })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeDefined()
      // The function should still return a result but with empty loops and parallels
      expect(result?.loops).toEqual({})
      expect(result?.parallels).toEqual({})
      // Verify blocks and edges are still processed correctly
      expect(result?.blocks).toBeDefined()
      expect(result?.edges).toBeDefined()
    })

    it('should handle malformed database responses', async () => {
      const malformedBlocks = [
        {
          id: 'block-1',
          workflowId: mockWorkflowId,
          // Missing required fields
          type: null,
          name: null,
          positionX: 0,
          positionY: 0,
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          height: 0,
          subBlocks: {},
          outputs: {},
          data: {},
          parentId: null,
          extent: null,
        },
      ]

      // Mock the database queries properly
      let callCount = 0
      mockDb.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve(malformedBlocks) // blocks query
            if (callCount === 2) return Promise.resolve([]) // edges query
            if (callCount === 3) return Promise.resolve([]) // subflows query
            return Promise.resolve([])
          }),
        }),
      })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeDefined()
      expect(result?.blocks['block-1']).toBeDefined()
      // The function should handle null type and name gracefully
      expect(result?.blocks['block-1'].type).toBeNull()
      expect(result?.blocks['block-1'].name).toBeNull()
    })

    it('should handle database connection errors gracefully', async () => {
      const connectionError = new Error('Connection refused')
      ;(connectionError as any).code = 'ECONNREFUSED'

      // Mock database connection error
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
        mockWorkflowState
      )

      expect(result.success).toBe(true)
      expect(result.jsonBlob).toBeDefined()
      expect(result.jsonBlob.blocks).toEqual(mockWorkflowState.blocks)
      expect(result.jsonBlob.edges).toEqual(mockWorkflowState.edges)
      expect(result.jsonBlob.loops).toEqual(mockWorkflowState.loops)
      expect(result.jsonBlob.parallels).toEqual(mockWorkflowState.parallels)

      // Verify transaction was called
      expect(mockTransaction).toHaveBeenCalledTimes(1)
    })

    it('should handle empty workflow state gracefully', async () => {
      const emptyWorkflowState: WorkflowState = {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        lastSaved: Date.now(),
        isDeployed: false,
        deploymentStatuses: {},
        hasActiveWebhook: false,
      }

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const tx = {
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
        emptyWorkflowState
      )

      expect(result.success).toBe(true)
      expect(result.jsonBlob.blocks).toEqual({})
      expect(result.jsonBlob.edges).toEqual([])
      expect(result.jsonBlob.loops).toEqual({})
      expect(result.jsonBlob.parallels).toEqual({})
    })

    it('should return error when transaction fails', async () => {
      const mockTransaction = vi.fn().mockRejectedValue(new Error('Transaction failed'))
      mockDb.transaction = mockTransaction

      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        mockWorkflowState
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
        mockWorkflowState
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
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockImplementation((data) => {
              // Capture the data based on which insert call it is
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

      await dbHelpers.saveWorkflowToNormalizedTables(mockWorkflowId, mockWorkflowState)

      expect(capturedBlockInserts).toHaveLength(2)
      expect(capturedBlockInserts[0]).toMatchObject({
        id: 'block-1',
        workflowId: mockWorkflowId,
        type: 'starter',
        name: 'Start Block',
        positionX: '100',
        positionY: '100',
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        height: '150',
        parentId: null,
        extent: null,
      })

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

  describe('migrateWorkflowToNormalizedTables', () => {
    const mockJsonState = {
      blocks: mockWorkflowState.blocks,
      edges: mockWorkflowState.edges,
      loops: mockWorkflowState.loops,
      parallels: mockWorkflowState.parallels,
      lastSaved: Date.now(),
      isDeployed: false,
      deploymentStatuses: {},
      hasActiveWebhook: false,
    }

    it('should successfully migrate workflow from JSON to normalized tables', async () => {
      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const tx = {
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

      const result = await dbHelpers.migrateWorkflowToNormalizedTables(
        mockWorkflowId,
        mockJsonState
      )

      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should return error when migration fails', async () => {
      const mockTransaction = vi.fn().mockRejectedValue(new Error('Migration failed'))
      mockDb.transaction = mockTransaction

      const result = await dbHelpers.migrateWorkflowToNormalizedTables(
        mockWorkflowId,
        mockJsonState
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Migration failed')
    })

    it('should handle missing properties in JSON state gracefully', async () => {
      const incompleteJsonState = {
        blocks: mockWorkflowState.blocks,
        edges: mockWorkflowState.edges,
        // Missing loops, parallels, and other properties
      }

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const tx = {
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

      const result = await dbHelpers.migrateWorkflowToNormalizedTables(
        mockWorkflowId,
        incompleteJsonState
      )

      expect(result.success).toBe(true)
    })

    it('should handle null/undefined JSON state', async () => {
      const result = await dbHelpers.migrateWorkflowToNormalizedTables(mockWorkflowId, null)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Cannot read properties')
    })
  })

  describe('error handling and edge cases', () => {
    it('should handle very large workflow data', async () => {
      const largeWorkflowState: WorkflowState = {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        lastSaved: Date.now(),
        isDeployed: false,
        deploymentStatuses: {},
        hasActiveWebhook: false,
      }

      // Create 1000 blocks
      for (let i = 0; i < 1000; i++) {
        largeWorkflowState.blocks[`block-${i}`] = {
          id: `block-${i}`,
          type: 'api',
          name: `Block ${i}`,
          position: { x: i * 100, y: i * 100 },
          subBlocks: {},
          outputs: {},
          enabled: true,
        }
      }

      // Create 999 edges to connect them
      for (let i = 0; i < 999; i++) {
        largeWorkflowState.edges.push({
          id: `edge-${i}`,
          source: `block-${i}`,
          target: `block-${i + 1}`,
        })
      }

      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const tx = {
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
        largeWorkflowState
      )

      expect(result.success).toBe(true)
      expect(Object.keys(result.jsonBlob.blocks)).toHaveLength(1000)
      expect(result.jsonBlob.edges).toHaveLength(999)
    })
  })

  describe('advancedMode persistence comparison with isWide', () => {
    it('should load advancedMode property exactly like isWide from database', async () => {
      const testBlocks = [
        {
          id: 'block-advanced-wide',
          workflowId: mockWorkflowId,
          type: 'agent',
          name: 'Advanced Wide Block',
          positionX: 100,
          positionY: 100,
          enabled: true,
          horizontalHandles: true,
          isWide: true,
          advancedMode: true,
          height: 200,
          subBlocks: {},
          outputs: {},
          data: {},
          parentId: null,
          extent: null,
        },
        {
          id: 'block-basic-narrow',
          workflowId: mockWorkflowId,
          type: 'agent',
          name: 'Basic Narrow Block',
          positionX: 200,
          positionY: 100,
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          advancedMode: false,
          height: 150,
          subBlocks: {},
          outputs: {},
          data: {},
          parentId: null,
          extent: null,
        },
        {
          id: 'block-advanced-narrow',
          workflowId: mockWorkflowId,
          type: 'agent',
          name: 'Advanced Narrow Block',
          positionX: 300,
          positionY: 100,
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          advancedMode: true,
          height: 180,
          subBlocks: {},
          outputs: {},
          data: {},
          parentId: null,
          extent: null,
        },
      ]

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

      // Test all combinations of isWide and advancedMode
      const advancedWideBlock = result?.blocks['block-advanced-wide']
      expect(advancedWideBlock?.isWide).toBe(true)
      expect(advancedWideBlock?.advancedMode).toBe(true)

      const basicNarrowBlock = result?.blocks['block-basic-narrow']
      expect(basicNarrowBlock?.isWide).toBe(false)
      expect(basicNarrowBlock?.advancedMode).toBe(false)

      const advancedNarrowBlock = result?.blocks['block-advanced-narrow']
      expect(advancedNarrowBlock?.isWide).toBe(false)
      expect(advancedNarrowBlock?.advancedMode).toBe(true)
    })

    it('should handle null/undefined advancedMode same way as isWide', async () => {
      const blocksWithMissingProperties = [
        {
          id: 'block-null-props',
          workflowId: mockWorkflowId,
          type: 'agent',
          name: 'Block with null properties',
          positionX: 100,
          positionY: 100,
          enabled: true,
          horizontalHandles: true,
          isWide: null,
          advancedMode: null,
          height: 150,
          subBlocks: {},
          outputs: {},
          data: {},
          parentId: null,
          extent: null,
        },
        {
          id: 'block-undefined-props',
          workflowId: mockWorkflowId,
          type: 'agent',
          name: 'Block with undefined properties',
          positionX: 200,
          positionY: 100,
          enabled: true,
          horizontalHandles: true,
          isWide: undefined,
          advancedMode: undefined,
          height: 150,
          subBlocks: {},
          outputs: {},
          data: {},
          parentId: null,
          extent: null,
        },
      ]

      vi.clearAllMocks()

      let callCount = 0
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve(blocksWithMissingProperties)
            return Promise.resolve([])
          }),
        }),
      }))

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeDefined()

      // Both isWide and advancedMode should handle null/undefined consistently
      const nullPropsBlock = result?.blocks['block-null-props']
      expect(nullPropsBlock?.isWide).toBeNull()
      expect(nullPropsBlock?.advancedMode).toBeNull()

      const undefinedPropsBlock = result?.blocks['block-undefined-props']
      expect(undefinedPropsBlock?.isWide).toBeUndefined()
      expect(undefinedPropsBlock?.advancedMode).toBeUndefined()
    })
  })

  describe('end-to-end advancedMode persistence verification', () => {
    it('should persist advancedMode through complete duplication and save cycle', async () => {
      // Simulate the exact user workflow:
      // 1. Create a block with advancedMode: true
      // 2. Duplicate the block
      // 3. Save workflow state (this was causing the bug)
      // 4. Reload from database (simulate refresh)
      // 5. Verify advancedMode is still true

      const originalBlock = {
        id: 'agent-original',
        workflowId: mockWorkflowId,
        type: 'agent',
        name: 'Agent 1',
        positionX: 100,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: true,
        advancedMode: true, // User sets this to advanced mode
        height: 200,
        subBlocks: {
          systemPrompt: {
            id: 'systemPrompt',
            type: 'textarea',
            value: 'You are a helpful assistant',
          },
          userPrompt: { id: 'userPrompt', type: 'textarea', value: 'Help the user' },
          model: { id: 'model', type: 'select', value: 'gpt-4o' },
        },
        outputs: {},
        data: {},
        parentId: null,
        extent: null,
      }

      const duplicatedBlock = {
        id: 'agent-duplicate',
        workflowId: mockWorkflowId,
        type: 'agent',
        name: 'Agent 2',
        positionX: 200,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: true,
        advancedMode: true, // Should be copied from original
        height: 200,
        subBlocks: {
          systemPrompt: {
            id: 'systemPrompt',
            type: 'textarea',
            value: 'You are a helpful assistant',
          },
          userPrompt: { id: 'userPrompt', type: 'textarea', value: 'Help the user' },
          model: { id: 'model', type: 'select', value: 'gpt-4o' },
        },
        outputs: {},
        data: {},
        parentId: null,
        extent: null,
      }

      // Step 1 & 2: Mock loading both original and duplicated blocks from database
      vi.clearAllMocks()

      let callCount = 0
      mockDb.select.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) return Promise.resolve([originalBlock, duplicatedBlock])
            if (callCount === 2) return Promise.resolve([]) // edges
            if (callCount === 3) return Promise.resolve([]) // subflows
            return Promise.resolve([])
          }),
        }),
      }))

      // Step 3: Load workflow state (simulates app loading after duplication)
      const loadedState = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)
      expect(loadedState).toBeDefined()
      expect(loadedState?.blocks['agent-original'].advancedMode).toBe(true)
      expect(loadedState?.blocks['agent-duplicate'].advancedMode).toBe(true)

      // Step 4: Test the critical saveWorkflowToNormalizedTables function
      // This was the function that was dropping advancedMode!
      const workflowState = {
        blocks: loadedState!.blocks,
        edges: loadedState!.edges,
        loops: {},
        parallels: {},
        deploymentStatuses: {},
        hasActiveWebhook: false,
      }

      // Mock the transaction for save operation
      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTx = {
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
          insert: vi.fn().mockImplementation((_table) => ({
            values: vi.fn().mockImplementation((values) => {
              // Verify that advancedMode is included in the insert values
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

      // Step 5: Save workflow state (this should preserve advancedMode)
      const saveResult = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        workflowState
      )
      expect(saveResult.success).toBe(true)

      // Step 6: Verify the JSON blob also preserves advancedMode
      expect(saveResult.jsonBlob?.blocks['agent-original'].advancedMode).toBe(true)
      expect(saveResult.jsonBlob?.blocks['agent-duplicate'].advancedMode).toBe(true)

      // Verify the database insert was called with the correct values
      expect(mockTransaction).toHaveBeenCalled()
    })

    it('should handle mixed advancedMode states correctly', async () => {
      // Test scenario: one block in advanced mode, one in basic mode
      const basicBlock = {
        id: 'agent-basic',
        workflowId: mockWorkflowId,
        type: 'agent',
        name: 'Basic Agent',
        positionX: 100,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: false,
        advancedMode: false, // Basic mode
        height: 150,
        subBlocks: { model: { id: 'model', type: 'select', value: 'gpt-4o' } },
        outputs: {},
        data: {},
        parentId: null,
        extent: null,
      }

      const advancedBlock = {
        id: 'agent-advanced',
        workflowId: mockWorkflowId,
        type: 'agent',
        name: 'Advanced Agent',
        positionX: 200,
        positionY: 100,
        enabled: true,
        horizontalHandles: true,
        isWide: true,
        advancedMode: true, // Advanced mode
        height: 200,
        subBlocks: {
          systemPrompt: { id: 'systemPrompt', type: 'textarea', value: 'System prompt' },
          userPrompt: { id: 'userPrompt', type: 'textarea', value: 'User prompt' },
          model: { id: 'model', type: 'select', value: 'gpt-4o' },
        },
        outputs: {},
        data: {},
        parentId: null,
        extent: null,
      }

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

      // Verify mixed states are preserved
      expect(loadedState?.blocks['agent-basic'].advancedMode).toBe(false)
      expect(loadedState?.blocks['agent-advanced'].advancedMode).toBe(true)

      // Verify other properties are also preserved correctly
      expect(loadedState?.blocks['agent-basic'].isWide).toBe(false)
      expect(loadedState?.blocks['agent-advanced'].isWide).toBe(true)
    })

    it('should preserve advancedMode during workflow state round-trip', async () => {
      // Test the complete round-trip: save to DB → load from DB
      const testWorkflowState = {
        blocks: {
          'block-1': {
            id: 'block-1',
            type: 'agent',
            name: 'Test Agent',
            position: { x: 100, y: 100 },
            subBlocks: {
              systemPrompt: { id: 'systemPrompt', type: 'long-input' as const, value: 'System' },
              model: { id: 'model', type: 'dropdown' as const, value: 'gpt-4o' },
            },
            outputs: {},
            enabled: true,
            horizontalHandles: true,
            isWide: true,
            advancedMode: true,
            height: 200,
            data: {},
          },
        },
        edges: [],
        loops: {},
        parallels: {},
        deploymentStatuses: {},
        hasActiveWebhook: false,
      }

      // Mock successful save
      const mockTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTx = {
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

      // Save the state
      const saveResult = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        testWorkflowState
      )
      expect(saveResult.success).toBe(true)

      // Mock loading the saved state back
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
                  isWide: true,
                  advancedMode: true, // This should be preserved
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

      // Load the state back
      const loadedState = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)
      expect(loadedState).toBeDefined()
      expect(loadedState?.blocks['block-1'].advancedMode).toBe(true)
      expect(loadedState?.blocks['block-1'].isWide).toBe(true)
    })
  })
})
