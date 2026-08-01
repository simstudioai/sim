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
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

const { mockSanitizeAgentToolsInBlocks } = vi.hoisted(() => ({
  mockSanitizeAgentToolsInBlocks: vi.fn(),
}))

/**
 * Default identity behavior for the mocked migration step. Re-applied in the
 * outer `beforeEach` because `vi.clearAllMocks()` clears implementations set
 * on the hoisted spy.
 */
const sanitizeIdentity = (blocks: unknown) => ({ blocks })
mockSanitizeAgentToolsInBlocks.mockImplementation(sanitizeIdentity)

vi.mock('@/lib/workflows/sanitization/validation', () => ({
  sanitizeAgentToolsInBlocks: mockSanitizeAgentToolsInBlocks,
}))

import * as dbHelpers from '@/lib/workflows/persistence/utils'

const mockWorkflowId = 'test-workflow-123'

/**
 * Queues the four table-routed result sets consumed by
 * `loadWorkflowFromNormalizedTablesRaw` (blocks, edges, subflows, workflow row).
 */
function queueLoadFixtures(options: {
  blocks: unknown[]
  edges?: unknown[]
  subflows?: unknown[]
  workspaceId?: string
}) {
  queueTableRows(schemaMock.workflowBlocks, options.blocks)
  queueTableRows(schemaMock.workflowEdges, options.edges ?? [])
  queueTableRows(schemaMock.workflowSubflows, options.subflows ?? [])
  queueTableRows(schemaMock.workflow, [{ workspaceId: options.workspaceId ?? 'test-workspace-id' }])
}

/**
 * Returns the row arrays passed to `insert(table).values(rows)` for the given
 * schema table. Insert/values chains run sequentially in the code under test,
 * so the two spies' call lists stay index-aligned.
 */
function insertedRowsFor(table: unknown): Record<string, unknown>[][] {
  return dbChainMockFns.insert.mock.calls.flatMap(([calledTable], index) =>
    calledTable === table && Array.isArray(dbChainMockFns.values.mock.calls[index]?.[0])
      ? [dbChainMockFns.values.mock.calls[index][0] as Record<string, unknown>[]]
      : []
  )
}

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
      count: 3,
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
      count: 5,
      distribution: ['item1', 'item2'],
      parallelType: 'count',
      batchSize: 1,
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
      count: 3,
      data: { width: 500, height: 300, parallelType: 'count', count: 3, batchSize: 1 },
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
      parallelType: 'count',
      batchSize: 1,
    },
  },
})

describe('Database Helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mockSanitizeAgentToolsInBlocks.mockImplementation(sanitizeIdentity)
  })

  afterAll(() => {
    resetDbChainMock()
  })

  describe('buildWorkflowDeploymentSnapshot', () => {
    it('combines normalized workflow state with persisted variables', () => {
      const snapshot = dbHelpers.buildWorkflowDeploymentSnapshot(
        {
          blocks: asAppBlocks({ block: createStarterBlock({ id: 'block' }) }),
          edges: [],
          loops: {},
          parallels: {},
          isFromNormalizedTables: true,
        },
        {
          variable: {
            id: 'variable',
            name: 'threshold',
            type: 'number',
            value: 5,
          },
        }
      )

      expect(snapshot.blocks.block).toBeDefined()
      expect(snapshot.edges).toEqual([])
      expect(snapshot.loops).toEqual({})
      expect(snapshot.parallels).toEqual({})
      expect(snapshot.variables).toEqual({
        variable: {
          id: 'variable',
          name: 'threshold',
          type: 'number',
          value: 5,
        },
      })
      expect(snapshot.lastSaved).toEqual(expect.any(Number))
    })
  })

  describe('loadWorkflowFromNormalizedTables', () => {
    it('should successfully load workflow data from normalized tables', async () => {
      queueLoadFixtures({
        blocks: mockBlocksFromDb,
        edges: mockEdgesFromDb,
        subflows: mockSubflowsFromDb,
      })

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
        batchSize: 1,
        enabled: true,
      })
      expect(result?.blocks['parallel-1'].data).toEqual(
        expect.objectContaining({
          count: 5,
          parallelType: 'count',
          batchSize: 1,
        })
      )
    })

    it('should return null when no blocks are found', async () => {
      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeNull()
    })

    it('should return null when database query fails', async () => {
      dbChainMockFns.where.mockImplementationOnce(() =>
        Promise.reject(new Error('Database connection failed'))
      )

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

      queueLoadFixtures({
        blocks: mockBlocksFromDb,
        edges: mockEdgesFromDb,
        subflows: subflowsWithUnknownType,
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

      queueLoadFixtures({ blocks: malformedBlocks })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeDefined()
      expect(result?.blocks['block-1']).toBeDefined()
      expect(result?.blocks['block-1'].type).toBeNull()
      expect(result?.blocks['block-1'].name).toBeNull()
    })

    it('should handle database connection errors gracefully', async () => {
      const connectionError = new Error('Connection refused')
      ;(connectionError as any).code = 'ECONNREFUSED'

      dbChainMockFns.where.mockImplementationOnce(() => Promise.reject(connectionError))

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toBeNull()
    })
  })

  describe('saveWorkflowToNormalizedTables', () => {
    it('should successfully save workflow data to normalized tables', async () => {
      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        asAppState(mockWorkflowState)
      )

      expect(result.success).toBe(true)

      expect(dbChainMockFns.transaction).toHaveBeenCalledTimes(1)
    })

    it('should handle empty workflow state gracefully', async () => {
      const emptyWorkflowState = createWorkflowState()

      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        asAppState(emptyWorkflowState)
      )

      expect(result.success).toBe(true)
    })

    it('should return error when transaction fails', async () => {
      dbChainMockFns.transaction.mockRejectedValueOnce(new Error('Transaction failed'))

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

      dbChainMockFns.transaction.mockRejectedValueOnce(constraintError)

      const result = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        asAppState(mockWorkflowState)
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Unique constraint violation')
    })

    it('should properly format block data for database insertion', async () => {
      await dbHelpers.saveWorkflowToNormalizedTables(mockWorkflowId, asAppState(mockWorkflowState))

      const [capturedBlockInserts = []] = insertedRowsFor(schemaMock.workflowBlocks)
      const [capturedEdgeInserts = []] = insertedRowsFor(schemaMock.workflowEdges)
      const [capturedSubflowInserts = []] = insertedRowsFor(schemaMock.workflowSubflows)

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
      expect(capturedSubflowInserts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'parallel-1',
            workflowId: mockWorkflowId,
            type: 'parallel',
            config: expect.objectContaining({
              count: 3,
              parallelType: 'count',
              batchSize: 1,
            }),
          }),
        ])
      )
    })

    it('should regenerate missing loop and parallel definitions from block data', async () => {
      const staleWorkflowState = structuredClone(mockWorkflowState)
      staleWorkflowState.loops = {}
      staleWorkflowState.parallels = {}

      await dbHelpers.saveWorkflowToNormalizedTables(mockWorkflowId, asAppState(staleWorkflowState))

      const [capturedSubflowInserts = []] = insertedRowsFor(schemaMock.workflowSubflows)

      expect(capturedSubflowInserts).toHaveLength(2)
      expect(capturedSubflowInserts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'loop-1', type: 'loop' }),
          expect.objectContaining({
            id: 'parallel-1',
            type: 'parallel',
            config: expect.objectContaining({ batchSize: 1 }),
          }),
        ])
      )
    })
  })

  describe('workflowExistsInNormalizedTables', () => {
    it('should return true when workflow exists in normalized tables', async () => {
      queueTableRows(schemaMock.workflowBlocks, [{ id: 'block-1' }])

      const result = await dbHelpers.workflowExistsInNormalizedTables(mockWorkflowId)

      expect(result).toBe(true)
    })

    it('should return false when workflow does not exist in normalized tables', async () => {
      const result = await dbHelpers.workflowExistsInNormalizedTables(mockWorkflowId)

      expect(result).toBe(false)
    })

    it('should return false when database query fails', async () => {
      dbChainMockFns.limit.mockImplementationOnce(() => Promise.reject(new Error('Database error')))

      const result = await dbHelpers.workflowExistsInNormalizedTables(mockWorkflowId)

      expect(result).toBe(false)
    })
  })

  describe('workflow row locking', () => {
    it('returns an error when undeploy cannot lock a workflow row', async () => {
      const result = await dbHelpers.undeployWorkflow({ workflowId: mockWorkflowId })

      expect(result).toEqual({
        success: false,
        error: 'Workflow not found',
      })
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('supersedes in-flight operations and releases path claims during undeploy', async () => {
      queueTableRows(schemaMock.workflow, [{ id: mockWorkflowId }])
      queueTableRows(schemaMock.workflowDeploymentVersion, [{ id: 'dv-1' }, { id: 'dv-2' }])
      const onUndeployTransaction = vi.fn().mockResolvedValue(undefined)

      const result = await dbHelpers.undeployWorkflow({
        workflowId: mockWorkflowId,
        onUndeployTransaction,
      })

      expect(result).toEqual({ success: true })
      const setCalls = dbChainMockFns.set.mock.calls.map(([payload]) => payload)
      expect(setCalls[0]).toEqual(expect.objectContaining({ status: 'superseded' }))
      expect(setCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ isActive: false }),
          expect.objectContaining({ isDeployed: false, deployedAt: null }),
        ])
      )
      expect(dbChainMockFns.delete).toHaveBeenCalledTimes(2)
      expect(onUndeployTransaction).toHaveBeenCalledWith(dbChainMock.db, {
        deploymentVersionIds: ['dv-1', 'dv-2'],
      })
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

      queueLoadFixtures({ blocks: testBlocks })

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

      queueLoadFixtures({ blocks: blocksWithDefaultValues })

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

      queueLoadFixtures({ blocks: [originalBlock, duplicatedBlock] })

      const loadedState = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)
      expect(loadedState).toBeDefined()
      expect(loadedState?.blocks['agent-original'].advancedMode).toBe(true)
      expect(loadedState?.blocks['agent-duplicate'].advancedMode).toBe(true)

      const workflowState = {
        blocks: loadedState!.blocks,
        edges: loadedState!.edges,
        loops: {},
        parallels: {},
      }

      const saveResult = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        workflowState
      )
      expect(saveResult.success).toBe(true)

      expect(dbChainMockFns.transaction).toHaveBeenCalled()

      const [blockInserts = []] = insertedRowsFor(schemaMock.workflowBlocks)
      const savedOriginal = blockInserts.find((row) => row.id === 'agent-original')
      const savedDuplicate = blockInserts.find((row) => row.id === 'agent-duplicate')
      expect(savedOriginal?.advancedMode).toBe(true)
      expect(savedDuplicate?.advancedMode).toBe(true)
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

      queueLoadFixtures({ blocks: [basicBlock, advancedBlock] })

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

      const saveResult = await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        asAppState(testWorkflowState)
      )
      expect(saveResult.success).toBe(true)

      queueLoadFixtures({
        blocks: [
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
        ],
      })

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

  describe('loadDeployedWorkflowState deployed-state cache', () => {
    /**
     * Minimal but realistic deployed state: a couple of plain (non-agent,
     * credential-free) blocks plus an edge. Plain blocks make the real
     * downstream migration steps (agent-message, subblock-id, credential,
     * canonical-mode) no-ops, so the only observable "heavy work" is the
     * mocked `sanitizeAgentToolsInBlocks` first step, which we use as the
     * migration call counter.
     */
    function buildDeployedState() {
      return {
        blocks: {
          'block-1': {
            id: 'block-1',
            type: 'api',
            name: 'API Block',
            position: { x: 0, y: 0 },
            enabled: true,
            subBlocks: { url: { id: 'url', type: 'short-input', value: 'https://example.com' } },
            outputs: {},
            data: {},
          },
          'block-2': {
            id: 'block-2',
            type: 'function',
            name: 'Function Block',
            position: { x: 100, y: 0 },
            enabled: true,
            subBlocks: { code: { id: 'code', type: 'code', value: 'return 1' } },
            outputs: {},
            data: {},
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
        loops: {},
        parallels: {},
        variables: { threshold: 5 },
      }
    }

    /**
     * Queues one active deployment-version row for the next active-version
     * SELECT; call once per expected `loadDeployedWorkflowState` invocation.
     * Tests assert SELECT counts on `dbChainMockFns.where`.
     */
    function queueActiveVersion(versionId: string, state: unknown) {
      queueTableRows(schemaMock.workflowDeploymentVersion, [
        { id: versionId, state, createdAt: new Date() },
      ])
    }

    beforeEach(() => {
      dbHelpers.invalidateDeployedStateCache()
    })

    it('serves a cache HIT, skipping migrations on the second call for the same active version', async () => {
      queueActiveVersion('dv-hit', buildDeployedState())
      queueActiveVersion('dv-hit', buildDeployedState())

      const first = await dbHelpers.loadDeployedWorkflowState('wf-1', 'workspace-1')
      const second = await dbHelpers.loadDeployedWorkflowState('wf-1', 'workspace-1')

      expect(first).toBeDefined()
      expect(second).toBeDefined()
      expect(mockSanitizeAgentToolsInBlocks).toHaveBeenCalledTimes(1)
      expect(dbChainMockFns.where).toHaveBeenCalledTimes(2)
    })

    it('still runs the active-version SELECT on every call so rollback/redeploy stays observable', async () => {
      queueActiveVersion('dv-active', buildDeployedState())
      queueActiveVersion('dv-active', buildDeployedState())

      await dbHelpers.loadDeployedWorkflowState('wf-2', 'workspace-1')
      await dbHelpers.loadDeployedWorkflowState('wf-2', 'workspace-1')

      expect(dbChainMockFns.where).toHaveBeenCalledTimes(2)
    })

    it('deep-clones on read: mutating the first result does not corrupt the cached copy', async () => {
      queueActiveVersion('dv-clone', buildDeployedState())
      queueActiveVersion('dv-clone', buildDeployedState())

      const first = await dbHelpers.loadDeployedWorkflowState('wf-3', 'workspace-1')
      ;(first.blocks['block-1'] as any).name = 'MUTATED'
      ;(first.blocks['block-1'].subBlocks.url as any).value = 'https://hacked.example'
      first.edges.push({
        id: 'edge-injected',
        source: 'block-2',
        target: 'block-1',
      } as any)

      const second = await dbHelpers.loadDeployedWorkflowState('wf-3', 'workspace-1')

      expect(second.blocks['block-1'].name).toBe('API Block')
      expect(second.blocks['block-1'].subBlocks.url.value).toBe('https://example.com')
      expect(second.edges).toHaveLength(1)
      expect(second.blocks).toEqual(buildDeployedState().blocks)
    })

    it('keys the cache by deploymentVersionId: a different active id triggers a fresh build', async () => {
      queueActiveVersion('dv-old', buildDeployedState())
      await dbHelpers.loadDeployedWorkflowState('wf-4', 'workspace-1')
      expect(mockSanitizeAgentToolsInBlocks).toHaveBeenCalledTimes(1)

      queueActiveVersion('dv-new', buildDeployedState())
      await dbHelpers.loadDeployedWorkflowState('wf-4', 'workspace-1')
      expect(mockSanitizeAgentToolsInBlocks).toHaveBeenCalledTimes(2)
    })

    it('loads an admitted immutable deployment version even after a later cutover', async () => {
      const state = buildDeployedState()
      queueTableRows(schemaMock.workflowDeploymentVersion, [{ id: 'dv-admitted', state }])

      const result = await dbHelpers.loadWorkflowDeploymentVersionState(
        'wf-admitted',
        'dv-admitted',
        'workspace-1'
      )

      expect(result.deploymentVersionId).toBe('dv-admitted')
      expect(result.blocks).toEqual(state.blocks)
      expect(dbChainMockFns.where).toHaveBeenCalledTimes(1)
    })

    it('invalidateDeployedStateCache(id) forces a rebuild on the next call', async () => {
      queueActiveVersion('dv-inv', buildDeployedState())
      queueActiveVersion('dv-inv', buildDeployedState())
      queueActiveVersion('dv-inv', buildDeployedState())

      await dbHelpers.loadDeployedWorkflowState('wf-5', 'workspace-1')
      await dbHelpers.loadDeployedWorkflowState('wf-5', 'workspace-1')
      expect(mockSanitizeAgentToolsInBlocks).toHaveBeenCalledTimes(1)

      dbHelpers.invalidateDeployedStateCache('dv-inv')

      await dbHelpers.loadDeployedWorkflowState('wf-5', 'workspace-1')
      expect(mockSanitizeAgentToolsInBlocks).toHaveBeenCalledTimes(2)
    })

    it('throws when there is no active deployment and does not cache the failure', async () => {
      await expect(dbHelpers.loadDeployedWorkflowState('wf-6', 'workspace-1')).rejects.toThrow(
        'Workflow wf-6 has no active deployment'
      )

      expect(mockSanitizeAgentToolsInBlocks).not.toHaveBeenCalled()
    })
  })
})
