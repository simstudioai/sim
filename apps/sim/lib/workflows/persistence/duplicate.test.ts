/**
 * @vitest-environment node
 */
import { mockConsoleLogger, setupCommonApiMocks } from '@sim/testing'
import { drizzleOrmMock } from '@sim/testing/mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockAuthorizeWorkflowByWorkspacePermission = vi.fn()
const mockGetUserEntityPermissions = vi.fn()

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    transaction: vi.fn(),
  },
}))

vi.mock('drizzle-orm', () => ({
  ...drizzleOrmMock,
  min: vi.fn((field) => ({ type: 'min', field })),
}))
vi.mock('@/lib/workflows/utils', () => ({
  authorizeWorkflowByWorkspacePermission: (...args: unknown[]) =>
    mockAuthorizeWorkflowByWorkspacePermission(...args),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: (...args: unknown[]) => mockGetUserEntityPermissions(...args),
}))

vi.mock('@sim/db/schema', () => ({
  workflow: {
    id: 'id',
    workspaceId: 'workspaceId',
    folderId: 'folderId',
    sortOrder: 'sortOrder',
    variables: 'variables',
  },
  workflowFolder: {
    workspaceId: 'workspaceId',
    parentId: 'parentId',
    sortOrder: 'sortOrder',
  },
  workflowBlocks: {
    workflowId: 'workflowId',
  },
  workflowEdges: {
    workflowId: 'workflowId',
  },
  workflowSubflows: {
    workflowId: 'workflowId',
  },
}))

vi.mock('@sim/db', () => ({
  db: mockDb,
}))

import { duplicateWorkflow } from './duplicate'

function createMockTx(
  selectResults: unknown[],
  onWorkflowInsert?: (values: Record<string, unknown>) => void
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
    setupCommonApiMocks()
    mockConsoleLogger()
    vi.clearAllMocks()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('new-workflow-id'),
    })

    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({ allowed: true })
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
})
