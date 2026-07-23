/**
 * @vitest-environment node
 */
import {
  dbChainMock,
  dbChainMockFns,
  queueTableRows,
  resetDbChainMock,
  schemaMock,
  workflowAuthzMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuthorizeWorkflowByWorkspacePermission =
  workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@sim/db', () => ({ ...dbChainMock, ...schemaMock }))

import { duplicateWorkflow } from '@/lib/workflows/persistence/duplicate'

/**
 * Queues the table-routed result sets consumed by `duplicateWorkflow`, in
 * chain order: source workflow lookup, sibling/folder minimum sort-order
 * aggregates, then the source blocks/edges/subflows reads.
 */
function queueDuplicateFixtures(options: {
  sourceWorkflow: Record<string, unknown>
  workflowMin?: unknown[]
  folderMin?: unknown[]
  blocks?: unknown[]
  edges?: unknown[]
  subflows?: unknown[]
}) {
  queueTableRows(schemaMock.workflow, [options.sourceWorkflow])
  queueTableRows(schemaMock.workflow, options.workflowMin ?? [])
  queueTableRows(schemaMock.workflowFolder, options.folderMin ?? [])
  queueTableRows(schemaMock.workflowBlocks, options.blocks ?? [])
  queueTableRows(schemaMock.workflowEdges, options.edges ?? [])
  queueTableRows(schemaMock.workflowSubflows, options.subflows ?? [])
}

/**
 * Returns each payload passed to `insert(table).values(payload)` for the given
 * schema table. Insert/values chains run sequentially in the code under test,
 * so the two spies' call lists stay index-aligned.
 */
function insertedValuesFor(table: unknown): unknown[] {
  return dbChainMockFns.insert.mock.calls.flatMap(([calledTable], index) =>
    calledTable === table ? [dbChainMockFns.values.mock.calls[index]?.[0]] : []
  )
}

describe('duplicateWorkflow ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('new-workflow-id'),
    })

    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { id: 'source-workflow-id', workspaceId: 'workspace-123' },
      workspacePermission: 'write',
    })
    workflowsUtilsMockFns.mockDeduplicateWorkflowName.mockImplementation(
      async (name: string) => name
    )
  })

  afterAll(() => {
    resetDbChainMock()
  })

  it('uses mixed-sibling top insertion sort order', async () => {
    queueDuplicateFixtures({
      sourceWorkflow: {
        id: 'source-workflow-id',
        workspaceId: 'workspace-123',
        folderId: null,
        description: 'source',
        variables: {},
      },
      workflowMin: [{ minOrder: 5 }],
      folderMin: [{ minOrder: 2 }],
    })

    const result = await duplicateWorkflow({
      sourceWorkflowId: 'source-workflow-id',
      userId: 'user-123',
      name: 'Duplicated',
      workspaceId: 'workspace-123',
      folderId: null,
      requestId: 'req-1',
    })

    expect(result.sortOrder).toBe(1)
    const insertedWorkflowValues = insertedValuesFor(schemaMock.workflow)[0] as Record<
      string,
      unknown
    >
    expect(insertedWorkflowValues?.sortOrder).toBe(1)
  })

  it('defaults to sortOrder 0 when target has no siblings', async () => {
    queueDuplicateFixtures({
      sourceWorkflow: {
        id: 'source-workflow-id',
        workspaceId: 'workspace-123',
        folderId: null,
        description: 'source',
        variables: {},
      },
    })

    const result = await duplicateWorkflow({
      sourceWorkflowId: 'source-workflow-id',
      userId: 'user-123',
      name: 'Duplicated',
      workspaceId: 'workspace-123',
      folderId: null,
      requestId: 'req-2',
    })

    expect(result.sortOrder).toBe(0)
    const insertedWorkflowValues = insertedValuesFor(schemaMock.workflow)[0] as Record<
      string,
      unknown
    >
    expect(insertedWorkflowValues?.sortOrder).toBe(0)
  })

  it('strips copied webhook runtime subblocks and remaps variable assignments', async () => {
    queueDuplicateFixtures({
      sourceWorkflow: {
        id: 'source-workflow-id',
        workspaceId: 'workspace-123',
        folderId: null,
        description: 'source',

        variables: {
          'old-var-id': {
            id: 'old-var-id',
            workflowId: 'source-workflow-id',
            name: 'customerName',
            type: 'string',
            value: 'Ada',
          },
        },
      },
      blocks: [
        {
          id: 'source-block-id',
          workflowId: 'source-workflow-id',
          type: 'generic_webhook',
          name: 'Webhook',
          parentId: null,
          extent: null,
          data: {},
          subBlocks: {
            triggerPath: { id: 'triggerPath', type: 'short-input', value: 'old-webhook-path' },
            webhookId: { id: 'webhookId', type: 'short-input', value: 'old-webhook-id' },
            webhookUrlDisplay: {
              id: 'webhookUrlDisplay',
              type: 'short-input',
              value: 'https://example.test/api/webhooks/trigger/old-webhook-path',
            },
            variables: {
              id: 'variables',
              type: 'variables-input',
              value: JSON.stringify([
                {
                  id: 'assignment-1',
                  variableId: 'old-var-id',
                  variableName: 'customerName',
                  type: 'string',
                  value: 'Grace',
                  isExisting: true,
                },
              ]),
            },
          },
          position: { x: 0, y: 0 },
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          height: 0,
          advancedMode: false,
          triggerMode: true,
          locked: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    })

    await duplicateWorkflow({
      sourceWorkflowId: 'source-workflow-id',
      userId: 'user-123',
      name: 'Duplicated',
      workspaceId: 'workspace-123',
      folderId: null,
      requestId: 'req-3',
    })

    const insertedBlocks = insertedValuesFor(schemaMock.workflowBlocks)[0] as Array<
      Record<string, unknown>
    >
    expect(insertedBlocks).toHaveLength(1)
    const copiedSubBlocks = insertedBlocks?.[0].subBlocks as Record<string, any>
    expect(copiedSubBlocks.triggerPath).toBeUndefined()
    expect(copiedSubBlocks.webhookId).toBeUndefined()
    expect(copiedSubBlocks.webhookUrlDisplay).toBeUndefined()
    expect(copiedSubBlocks.variables.value[0].variableId).not.toBe('old-var-id')
    expect(copiedSubBlocks.variables.value[0].variableName).toBe('customerName')
    expect(insertedBlocks?.[0].locked).toBe(false)
  })

  it('remaps variable assignments when duplicating an already-duplicated source (array value)', async () => {
    queueDuplicateFixtures({
      sourceWorkflow: {
        id: 'first-copy-workflow-id',
        workspaceId: 'workspace-123',
        folderId: null,
        description: 'first copy',

        variables: {
          'first-copy-var-id': {
            id: 'first-copy-var-id',
            workflowId: 'first-copy-workflow-id',
            name: 'customerName',
            type: 'string',
            value: 'Ada',
          },
        },
      },
      blocks: [
        {
          id: 'first-copy-block-id',
          workflowId: 'first-copy-workflow-id',
          type: 'agent',
          name: 'Agent',
          parentId: null,
          extent: null,
          data: {},
          subBlocks: {
            variables: {
              id: 'variables',
              type: 'variables-input',
              value: [
                {
                  id: 'assignment-1',
                  variableId: 'first-copy-var-id',
                  variableName: 'customerName',
                  type: 'string',
                  value: 'Grace',
                  isExisting: true,
                },
              ],
            },
          },
          position: { x: 0, y: 0 },
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          height: 0,
          advancedMode: false,
          triggerMode: false,
          locked: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    })

    await duplicateWorkflow({
      sourceWorkflowId: 'first-copy-workflow-id',
      userId: 'user-123',
      name: 'Duplicated Again',
      workspaceId: 'workspace-123',
      folderId: null,
      requestId: 'req-second-copy',
    })

    const insertedBlocks = insertedValuesFor(schemaMock.workflowBlocks)[0] as Array<
      Record<string, unknown>
    >
    expect(insertedBlocks).toHaveLength(1)
    const copiedSubBlocks = insertedBlocks?.[0].subBlocks as Record<string, any>
    expect(Array.isArray(copiedSubBlocks.variables.value)).toBe(true)
    expect(copiedSubBlocks.variables.value).toHaveLength(1)

    const insertedWorkflowValues = insertedValuesFor(schemaMock.workflow)[0] as Record<
      string,
      unknown
    >
    const newVarIds = Object.keys(
      (insertedWorkflowValues?.variables as Record<string, unknown>) || {}
    )
    expect(newVarIds).toHaveLength(1)
    const remappedVarId = copiedSubBlocks.variables.value[0].variableId
    expect(remappedVarId).not.toBe('first-copy-var-id')
    expect(remappedVarId).toBe(newVarIds[0])
    expect(copiedSubBlocks.variables.value[0].variableName).toBe('customerName')
  })

  it('preserves remap when an edge references an unknown source block (drops the edge with a warning)', async () => {
    queueDuplicateFixtures({
      sourceWorkflow: {
        id: 'source-workflow-id',
        workspaceId: 'workspace-123',
        folderId: null,
        description: 'source',
        variables: {},
      },
      blocks: [
        {
          id: 'block-a',
          workflowId: 'source-workflow-id',
          type: 'agent',
          name: 'Agent A',
          parentId: null,
          extent: null,
          data: {},
          subBlocks: {},
          position: { x: 0, y: 0 },
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          height: 0,
          advancedMode: false,
          triggerMode: false,
          locked: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'block-b',
          workflowId: 'source-workflow-id',
          type: 'agent',
          name: 'Agent B',
          parentId: null,
          extent: null,
          data: {},
          subBlocks: {},
          position: { x: 0, y: 0 },
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          height: 0,
          advancedMode: false,
          triggerMode: false,
          locked: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      edges: [
        {
          id: 'edge-valid',
          workflowId: 'source-workflow-id',
          sourceBlockId: 'block-a',
          targetBlockId: 'block-b',
          sourceHandle: null,
          targetHandle: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'edge-orphan',
          workflowId: 'source-workflow-id',
          sourceBlockId: 'unknown-source-block',
          targetBlockId: 'block-b',
          sourceHandle: null,
          targetHandle: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    })

    await expect(
      duplicateWorkflow({
        sourceWorkflowId: 'source-workflow-id',
        userId: 'user-123',
        name: 'Duplicated',
        workspaceId: 'workspace-123',
        folderId: null,
        requestId: 'req-orphan-edge',
      })
    ).resolves.toBeDefined()

    const insertedEdges = insertedValuesFor(schemaMock.workflowEdges)[0] as Array<
      Record<string, unknown>
    >
    expect(insertedEdges).toHaveLength(1)
    const onlyEdge = insertedEdges?.[0]
    expect(onlyEdge?.sourceBlockId).not.toBe('unknown-source-block')
    expect(onlyEdge?.sourceBlockId).toEqual(expect.any(String))
    expect(onlyEdge?.targetBlockId).toEqual(expect.any(String))
  })

  it('preserves remap when a subflow references an unknown node (drops the node with a warning)', async () => {
    queueDuplicateFixtures({
      sourceWorkflow: {
        id: 'source-workflow-id',
        workspaceId: 'workspace-123',
        folderId: null,
        description: 'source',
        variables: {},
      },
      blocks: [
        {
          id: 'loop-block',
          workflowId: 'source-workflow-id',
          type: 'loop',
          name: 'Loop',
          parentId: null,
          extent: null,
          data: {},
          subBlocks: {},
          position: { x: 0, y: 0 },
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          height: 0,
          advancedMode: false,
          triggerMode: false,
          locked: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'known-node',
          workflowId: 'source-workflow-id',
          type: 'agent',
          name: 'Agent',
          parentId: null,
          extent: null,
          data: {},
          subBlocks: {},
          position: { x: 0, y: 0 },
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          height: 0,
          advancedMode: false,
          triggerMode: false,
          locked: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      subflows: [
        {
          id: 'loop-block',
          workflowId: 'source-workflow-id',
          type: 'loop',
          config: {
            id: 'loop-block',
            nodes: ['known-node', 'unknown-node'],
            iterations: 1,
            loopType: 'for',
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    })

    await expect(
      duplicateWorkflow({
        sourceWorkflowId: 'source-workflow-id',
        userId: 'user-123',
        name: 'Duplicated',
        workspaceId: 'workspace-123',
        folderId: null,
        requestId: 'req-orphan-subflow',
      })
    ).resolves.toBeDefined()

    const insertedSubflows = insertedValuesFor(schemaMock.workflowSubflows)[0] as Array<
      Record<string, unknown>
    >
    expect(insertedSubflows).toHaveLength(1)
    const remappedConfig = insertedSubflows?.[0].config as { nodes: string[] }
    expect(Array.isArray(remappedConfig.nodes)).toBe(true)
    expect(remappedConfig.nodes).toHaveLength(1)
    expect(remappedConfig.nodes[0]).not.toBe('unknown-node')
    expect(remappedConfig.nodes[0]).toEqual(expect.any(String))
  })

  it('preserves stale variable references instead of failing the duplicate', async () => {
    queueDuplicateFixtures({
      sourceWorkflow: {
        id: 'source-workflow-id',
        workspaceId: 'workspace-123',
        folderId: null,
        description: 'source',

        variables: {
          'live-var-id': {
            id: 'live-var-id',
            workflowId: 'source-workflow-id',
            name: 'customerName',
            type: 'string',
            value: 'Ada',
          },
        },
      },
      blocks: [
        {
          id: 'source-block-id',
          workflowId: 'source-workflow-id',
          type: 'agent',
          name: 'Agent',
          parentId: null,
          extent: null,
          data: {},
          subBlocks: {
            variables: {
              id: 'variables',
              type: 'variables-input',
              value: [
                {
                  id: 'assignment-1',
                  variableId: 'deleted-var-id',
                  variableName: 'customerName',
                  type: 'string',
                  value: 'Grace',
                  isExisting: true,
                },
              ],
            },
          },
          position: { x: 0, y: 0 },
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          height: 0,
          advancedMode: false,
          triggerMode: false,
          locked: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    })

    await expect(
      duplicateWorkflow({
        sourceWorkflowId: 'source-workflow-id',
        userId: 'user-123',
        name: 'Duplicated',
        workspaceId: 'workspace-123',
        folderId: null,
        requestId: 'req-stale',
      })
    ).resolves.toBeDefined()

    const insertedBlocks = insertedValuesFor(schemaMock.workflowBlocks)[0] as Array<
      Record<string, unknown>
    >
    expect(insertedBlocks).toHaveLength(1)
    const copiedSubBlocks = insertedBlocks?.[0].subBlocks as Record<string, any>
    expect(copiedSubBlocks.variables.value[0].variableId).toBe('deleted-var-id')
    expect(copiedSubBlocks.variables.value[0].variableName).toBe('customerName')
  })
})
