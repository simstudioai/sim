/**
 * Database Helpers Unit Tests
 *
 * Tests for normalized table operations including loading, saving, and migrating
 * workflow data between JSON blob format and normalized database tables.
 */

import {
  createAgentBlock,
  createApiBlock,
  type createBlock,
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
import { workflowStateSchema } from '@/lib/api/contracts/workflows'
import type {
  BlockState as AppBlockState,
  WorkflowState as AppWorkflowState,
} from '@/stores/workflows/workflow/types'
import { generateLoopBlocks } from '@/stores/workflows/workflow/utils'

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
import { loadWorkflowReadSnapshot } from '@/lib/workflows/queries'

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
    errorEnabled: block.errorEnabled ?? false,
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

/**
 * The ungoverned write every characterization here performs: these exercise the
 * table mechanics, not the permission-group gate, and a `null` subject is how a
 * caller declares the write is not a member's authoring action.
 */
const UNGOVERNED = { workspaceId: null, subjectUserId: null }

describe('Database Helpers', () => {
  beforeEach(() => {
    resetDbChainMock()
    mockSanitizeAgentToolsInBlocks.mockImplementation(sanitizeIdentity)
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('reads a legacy workflow snapshot without scheduling migration writes', async () => {
    queueLoadFixtures({
      blocks: [
        toDbBlock(
          createStarterBlock({
            id: 'start',
            subBlocks: legacySubBlocks({
              _removed_oldSecret: { id: '_removed_oldSecret', type: 'short-input', value: 'old' },
            }),
          }),
          mockWorkflowId
        ),
      ],
    })
    queueTableRows(schemaMock.workflow, [{ id: mockWorkflowId, workspaceId: 'test-workspace-id' }])

    const snapshot = await loadWorkflowReadSnapshot(mockWorkflowId, 'test-workspace-id')

    expect(snapshot.normalizedData?.blocks.start.subBlocks).not.toHaveProperty('_removed_oldSecret')
    await Promise.resolve()
    expect(dbChainMockFns.update).not.toHaveBeenCalled()
    expect(dbChainMockFns.insert).not.toHaveBeenCalled()
  })

  describe('loadWorkflowDeploymentSnapshot', () => {
    it('loads a normalized snapshot without persisting legacy block migrations', async () => {
      queueLoadFixtures({
        blocks: [
          toDbBlock(
            createStarterBlock({
              id: 'start',
              subBlocks: legacySubBlocks({
                _removed_oldSecret: {
                  id: '_removed_oldSecret',
                  type: 'short-input',
                  value: 'old',
                },
              }),
            }),
            mockWorkflowId
          ),
        ],
      })

      const snapshot = await dbHelpers.loadWorkflowDeploymentSnapshot(mockWorkflowId)

      expect(snapshot?.blocks.start.subBlocks).not.toHaveProperty('_removed_oldSecret')
      await Promise.resolve()
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
      expect(dbChainMockFns.insert).not.toHaveBeenCalled()
    })
  })

  describe('loadWorkflowFromNormalizedTables', () => {
    it.each([false, true])(
      'normalizes legacy blocks with persistMigrations=%s',
      async (persistMigrations) => {
        queueLoadFixtures({
          blocks: [
            toDbBlock(
              createStarterBlock({
                id: 'start',
                subBlocks: legacySubBlocks({
                  _removed_oldSecret: {
                    id: '_removed_oldSecret',
                    type: 'short-input',
                    value: 'old',
                  },
                }),
              }),
              mockWorkflowId
            ),
          ],
        })
        const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId, undefined, {
          persistMigrations,
        })
        expect(result?.blocks.start.subBlocks).not.toHaveProperty('_removed_oldSecret')
        await Promise.resolve()
        expect(dbChainMockFns.update).toHaveBeenCalledTimes(persistMigrations ? 1 : 0)
        expect(dbChainMockFns.insert).not.toHaveBeenCalled()
        expect(dbChainMockFns.transaction).not.toHaveBeenCalled()
      }
    )

    it.each(['for', 'forEach', 'while', 'doWhile'] as const)(
      'preserves valid block counts and expressions for %s loops even when subflow counts differ',
      async (loopType) => {
        const data = {
          count: 9,
          loopType,
          collection: '<source.items>',
          whileCondition: '<source.hasMore>',
          doWhileCondition: '<source.hasMore>',
          width: 600,
          parentId: 'outer-loop',
          extent: 'parent' as const,
        }
        queueLoadFixtures({
          blocks: [{ ...toDbBlock(createLoopBlock({ id: 'loop-1' }), mockWorkflowId), data }],
          subflows: [
            {
              id: 'loop-1',
              type: 'loop',
              config: {
                nodes: [],
                loopType,
                iterations: 3,
                forEachItems: data.collection,
                whileCondition: data.whileCondition,
                doWhileCondition: data.doWhileCondition,
              },
            },
          ],
        })

        const loaded = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)
        const parsed = workflowStateSchema.parse(loaded)

        expect(parsed.blocks['loop-1'].data).toEqual(data)
        expect(parsed.loops?.['loop-1'].iterations).toBe(3)
        expect(generateLoopBlocks(loaded!.blocks)['loop-1']).toMatchObject({
          iterations: 9,
          loopType,
          forEachItems: data.collection,
          whileCondition: data.whileCondition,
          doWhileCondition: data.doWhileCondition,
        })
        expect(dbChainMockFns.update).not.toHaveBeenCalled()
      }
    )

    it('keeps an absent block count absent so serialization retains its existing default', async () => {
      queueLoadFixtures({
        blocks: [
          {
            ...toDbBlock(createLoopBlock({ id: 'loop-1' }), mockWorkflowId),
            data: { loopType: 'for' },
          },
        ],
        subflows: [
          { id: 'loop-1', type: 'loop', config: { nodes: [], loopType: 'for', iterations: 3 } },
        ],
      })

      const loaded = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(loaded?.blocks['loop-1'].data?.count).toBeUndefined()
      expect(Object.hasOwn(loaded!.blocks['loop-1'].data!, 'count')).toBe(false)
      expect(loaded?.loops['loop-1'].iterations).toBe(3)
      expect(generateLoopBlocks(loaded!.blocks)['loop-1'].iterations).toBe(5)
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

    it('serves a legacy forEach loop with a string count through the workflow read contract', async () => {
      const collection = '<source.items>'
      const loopRow = toDbBlock(createLoopBlock({ id: 'loop-1' }), mockWorkflowId)
      queueLoadFixtures({
        blocks: [
          {
            ...loopRow,
            data: { ...loopRow.data, loopType: 'forEach', count: collection, collection },
          },
        ],
        subflows: [
          {
            id: 'loop-1',
            type: 'loop',
            config: {
              nodes: [],
              loopType: 'forEach',
              iterations: collection,
              forEachItems: collection,
            },
          },
        ],
      })

      const loaded = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)
      const parsed = workflowStateSchema.parse(loaded)

      expect(parsed.blocks['loop-1'].data).toMatchObject({ count: 1, collection })
      expect(parsed.loops?.['loop-1']).toMatchObject({
        loopType: 'forEach',
        iterations: 1,
        forEachItems: collection,
      })
      expect(dbChainMockFns.update).not.toHaveBeenCalled()
    })

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
        errorEnabled: false,
        horizontalHandles: true,
        height: 150,
        subBlocks: { input: { id: 'input', type: 'short-input' as const, value: 'test' } },
        outputs: { result: { type: 'string' } },
        data: { parentId: undefined, extent: undefined, width: 350 },
        advancedMode: false,
        triggerMode: false,
        locked: undefined,
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
      expect(result?.blocks['loop-1'].data?.count).toBe(3)

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

    it('should load an existing blockless workflow as an empty graph', async () => {
      queueLoadFixtures({ blocks: [] })

      const result = await dbHelpers.loadWorkflowFromNormalizedTables(mockWorkflowId)

      expect(result).toMatchObject({
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        isFromNormalizedTables: true,
      })
    })
  })

  describe('saveWorkflowToNormalizedTables', () => {
    it('should regenerate missing loop and parallel definitions from block data', async () => {
      const staleWorkflowState = structuredClone(mockWorkflowState)
      staleWorkflowState.loops = {}
      staleWorkflowState.parallels = {}

      await dbHelpers.saveWorkflowToNormalizedTables(
        mockWorkflowId,
        asAppState(staleWorkflowState),
        UNGOVERNED
      )

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

    /**
     * Every version before the error toggle drew that port unconditionally, so a
     * snapshot carrying an error edge was taken from a block that had the output
     * on. The migration backfilling the flag only reaches the live tables, never
     * a version's frozen jsonb — so without deriving it here the deployed side
     * reads `false` against a live `true`, and every workflow deployed before the
     * toggle asks to be redeployed once.
     */
    it('reads an error edge in an old snapshot as the error output being on', async () => {
      const state = buildDeployedState()
      state.edges.push({
        id: 'edge-err',
        source: 'block-1',
        target: 'block-2',
        sourceHandle: 'error',
        targetHandle: 'input',
      })
      queueActiveVersion('dv-error-edge', state)

      const deployed = await dbHelpers.loadDeployedWorkflowState('wf-error-edge', 'workspace-1')

      expect(deployed?.blocks['block-1'].errorEnabled).toBe(true)
      expect(deployed?.blocks['block-2'].errorEnabled).toBeUndefined()
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
