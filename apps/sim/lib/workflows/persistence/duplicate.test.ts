/**
 * @vitest-environment node
 */
import {
  permissionsMock,
  permissionsMockFns,
  workflowAuthzMockFns,
  workflowsUtilsMock,
  workflowsUtilsMockFns,
} from '@sim/testing'
import { drizzleOrmMock } from '@sim/testing/mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuthorizeWorkflowByWorkspacePermission =
  workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission
const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    transaction: vi.fn(),
  },
}))

vi.mock('drizzle-orm', () => ({
  ...drizzleOrmMock,
  min: vi.fn((field) => ({ type: 'min', field })),
}))
vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@sim/db', () => ({
  db: mockDb,
}))

import { duplicateWorkflow } from './duplicate'

function createMockTx(
  selectResults: unknown[],
  onWorkflowInsert?: (values: Record<string, unknown>) => void,
  onInsert?: (values: unknown) => void
) {
  let selectCallCount = 0

  const select = vi.fn().mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        const result = selectResults[selectCallCount++] ?? []
        if (selectCallCount === 1) {
          return {
            limit: vi.fn().mockResolvedValue(result),
          }
        }
        return Promise.resolve(result)
      }),
    }),
  }))

  const insert = vi.fn().mockReturnValue({
    values: vi.fn().mockImplementation((values: Record<string, unknown>) => {
      onWorkflowInsert?.(values)
      onInsert?.(values)
      return Promise.resolve(undefined)
    }),
  })

  const update = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  })

  return {
    select,
    insert,
    update,
  }
}

describe('duplicateWorkflow ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('new-workflow-id'),
    })

    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({ allowed: true })
    workflowsUtilsMockFns.mockDeduplicateWorkflowName.mockImplementation(
      async (name: string) => name
    )
    mockGetUserEntityPermissions.mockResolvedValue('write')
  })

  it('uses mixed-sibling top insertion sort order', async () => {
    let insertedWorkflowValues: Record<string, unknown> | null = null
    const tx = createMockTx(
      [
        [
          {
            id: 'source-workflow-id',
            workspaceId: 'workspace-123',
            folderId: null,
            description: 'source',
            color: '#000000',
            variables: {},
          },
        ],
        [{ minOrder: 5 }],
        [{ minOrder: 2 }],
        [],
        [],
        [],
      ],
      (values) => {
        insertedWorkflowValues = values
      }
    )

    mockDb.transaction.mockImplementation(async (callback: (txArg: unknown) => Promise<unknown>) =>
      callback(tx)
    )

    const result = await duplicateWorkflow({
      sourceWorkflowId: 'source-workflow-id',
      userId: 'user-123',
      name: 'Duplicated',
      workspaceId: 'workspace-123',
      folderId: null,
      requestId: 'req-1',
    })

    expect(result.sortOrder).toBe(1)
    expect(insertedWorkflowValues?.sortOrder).toBe(1)
  })

  it('defaults to sortOrder 0 when target has no siblings', async () => {
    let insertedWorkflowValues: Record<string, unknown> | null = null
    const tx = createMockTx(
      [
        [
          {
            id: 'source-workflow-id',
            workspaceId: 'workspace-123',
            folderId: null,
            description: 'source',
            color: '#000000',
            variables: {},
          },
        ],
        [],
        [],
        [],
        [],
        [],
      ],
      (values) => {
        insertedWorkflowValues = values
      }
    )

    mockDb.transaction.mockImplementation(async (callback: (txArg: unknown) => Promise<unknown>) =>
      callback(tx)
    )

    const result = await duplicateWorkflow({
      sourceWorkflowId: 'source-workflow-id',
      userId: 'user-123',
      name: 'Duplicated',
      workspaceId: 'workspace-123',
      folderId: null,
      requestId: 'req-2',
    })

    expect(result.sortOrder).toBe(0)
    expect(insertedWorkflowValues?.sortOrder).toBe(0)
  })

  it('strips copied webhook runtime subblocks and remaps variable assignments', async () => {
    let insertedBlocks: Array<Record<string, unknown>> | null = null
    const tx = createMockTx(
      [
        [
          {
            id: 'source-workflow-id',
            workspaceId: 'workspace-123',
            folderId: null,
            description: 'source',
            color: '#000000',
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
        ],
        [],
        [],
        [
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
        [],
        [],
      ],
      undefined,
      (values) => {
        if (Array.isArray(values)) {
          insertedBlocks = values as Array<Record<string, unknown>>
        }
      }
    )

    mockDb.transaction.mockImplementation(async (callback: (txArg: unknown) => Promise<unknown>) =>
      callback(tx)
    )

    await duplicateWorkflow({
      sourceWorkflowId: 'source-workflow-id',
      userId: 'user-123',
      name: 'Duplicated',
      workspaceId: 'workspace-123',
      folderId: null,
      requestId: 'req-3',
    })

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
    let insertedBlocks: Array<Record<string, unknown>> | null = null
    let insertedWorkflowValues: Record<string, unknown> | null = null
    const tx = createMockTx(
      [
        [
          {
            id: 'first-copy-workflow-id',
            workspaceId: 'workspace-123',
            folderId: null,
            description: 'first copy',
            color: '#000000',
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
        ],
        [],
        [],
        [
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
        [],
        [],
      ],
      (values) => {
        if (!insertedWorkflowValues && !Array.isArray(values)) {
          insertedWorkflowValues = values
        }
      },
      (values) => {
        if (Array.isArray(values)) {
          insertedBlocks = values as Array<Record<string, unknown>>
        }
      }
    )

    mockDb.transaction.mockImplementation(async (callback: (txArg: unknown) => Promise<unknown>) =>
      callback(tx)
    )

    await duplicateWorkflow({
      sourceWorkflowId: 'first-copy-workflow-id',
      userId: 'user-123',
      name: 'Duplicated Again',
      workspaceId: 'workspace-123',
      folderId: null,
      requestId: 'req-second-copy',
    })

    expect(insertedBlocks).toHaveLength(1)
    const copiedSubBlocks = insertedBlocks?.[0].subBlocks as Record<string, any>
    expect(Array.isArray(copiedSubBlocks.variables.value)).toBe(true)
    expect(copiedSubBlocks.variables.value).toHaveLength(1)

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
    let insertedEdges: Array<Record<string, unknown>> | null = null
    const tx = createMockTx(
      [
        [
          {
            id: 'source-workflow-id',
            workspaceId: 'workspace-123',
            folderId: null,
            description: 'source',
            color: '#000000',
            variables: {},
          },
        ],
        [],
        [],
        [
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
        [
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
        [],
      ],
      undefined,
      (values) => {
        if (
          Array.isArray(values) &&
          values.length > 0 &&
          (values[0] as Record<string, unknown>)?.sourceBlockId !== undefined
        ) {
          insertedEdges = values as Array<Record<string, unknown>>
        }
      }
    )

    mockDb.transaction.mockImplementation(async (callback: (txArg: unknown) => Promise<unknown>) =>
      callback(tx)
    )

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

    expect(insertedEdges).toHaveLength(1)
    const onlyEdge = insertedEdges?.[0]
    expect(onlyEdge?.sourceBlockId).not.toBe('unknown-source-block')
    expect(onlyEdge?.sourceBlockId).toEqual(expect.any(String))
    expect(onlyEdge?.targetBlockId).toEqual(expect.any(String))
  })

  it('preserves remap when a subflow references an unknown node (drops the node with a warning)', async () => {
    let insertedSubflows: Array<Record<string, unknown>> | null = null
    const tx = createMockTx(
      [
        [
          {
            id: 'source-workflow-id',
            workspaceId: 'workspace-123',
            folderId: null,
            description: 'source',
            color: '#000000',
            variables: {},
          },
        ],
        [],
        [],
        [
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
        [],
        [
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
      ],
      undefined,
      (values) => {
        if (
          Array.isArray(values) &&
          values.length > 0 &&
          (values[0] as Record<string, unknown>)?.config !== undefined
        ) {
          insertedSubflows = values as Array<Record<string, unknown>>
        }
      }
    )

    mockDb.transaction.mockImplementation(async (callback: (txArg: unknown) => Promise<unknown>) =>
      callback(tx)
    )

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

    expect(insertedSubflows).toHaveLength(1)
    const remappedConfig = insertedSubflows?.[0].config as { nodes: string[] }
    expect(Array.isArray(remappedConfig.nodes)).toBe(true)
    expect(remappedConfig.nodes).toHaveLength(1)
    expect(remappedConfig.nodes[0]).not.toBe('unknown-node')
    expect(remappedConfig.nodes[0]).toEqual(expect.any(String))
  })

  it('preserves stale variable references instead of failing the duplicate', async () => {
    let insertedBlocks: Array<Record<string, unknown>> | null = null
    const tx = createMockTx(
      [
        [
          {
            id: 'source-workflow-id',
            workspaceId: 'workspace-123',
            folderId: null,
            description: 'source',
            color: '#000000',
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
        ],
        [],
        [],
        [
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
        [],
        [],
      ],
      undefined,
      (values) => {
        if (Array.isArray(values)) {
          insertedBlocks = values as Array<Record<string, unknown>>
        }
      }
    )

    mockDb.transaction.mockImplementation(async (callback: (txArg: unknown) => Promise<unknown>) =>
      callback(tx)
    )

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

    expect(insertedBlocks).toHaveLength(1)
    const copiedSubBlocks = insertedBlocks?.[0].subBlocks as Record<string, any>
    expect(copiedSubBlocks.variables.value[0].variableId).toBe('deleted-var-id')
    expect(copiedSubBlocks.variables.value[0].variableName).toBe('customerName')
  })
})
