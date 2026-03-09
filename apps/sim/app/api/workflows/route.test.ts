/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { drizzleOrmMock } from '@sim/testing/mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckSessionOrInternalAuth,
  mockGetUserEntityPermissions,
  mockWorkflowCreated,
  mockDbSelect,
  mockDbInsert,
  mockWorkspaceExists,
  mockVerifyWorkspaceMembership,
} = vi.hoisted(() => ({
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockWorkflowCreated: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockWorkspaceExists: vi.fn(),
  mockVerifyWorkspaceMembership: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({
  ...drizzleOrmMock,
  min: vi.fn((field) => ({ type: 'min', field })),
  count: vi.fn(() => ({ type: 'count' })),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
  },
}))

vi.mock('@sim/db/schema', () => ({
  workflowFolder: {
    id: 'id',
    userId: 'userId',
    parentId: 'parentId',
    updatedAt: 'updatedAt',
    workspaceId: 'workspaceId',
    sortOrder: 'sortOrder',
    createdAt: 'createdAt',
  },
  workflow: {
    id: 'id',
    folderId: 'folderId',
    userId: 'userId',
    updatedAt: 'updatedAt',
    workspaceId: 'workspaceId',
    sortOrder: 'sortOrder',
    createdAt: 'createdAt',
  },
  permissions: {
    entityId: 'entityId',
    userId: 'userId',
    entityType: 'entityType',
  },
}))

vi.mock('@/lib/audit/log', () => ({
  recordAudit: vi.fn(),
  AuditAction: { WORKFLOW_CREATED: 'workflow.created' },
  AuditResourceType: { WORKFLOW: 'workflow' },
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkHybridAuth: vi.fn(),
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
  checkInternalAuth: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getUserEntityPermissions: (...args: unknown[]) => mockGetUserEntityPermissions(...args),
  workspaceExists: (...args: unknown[]) => mockWorkspaceExists(...args),
}))

vi.mock('@/app/api/workflows/utils', () => ({
  verifyWorkspaceMembership: (...args: unknown[]) => mockVerifyWorkspaceMembership(...args),
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: {
    workflowCreated: (...args: unknown[]) => mockWorkflowCreated(...args),
  },
}))

import { GET, POST } from '@/app/api/workflows/route'

describe('Workflows API Route - POST ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('workflow-new-id'),
    })

    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      userName: 'Test User',
      userEmail: 'test@example.com',
    })
    mockGetUserEntityPermissions.mockResolvedValue('write')
  })

  it('uses top insertion against mixed siblings (folders + workflows)', async () => {
    const minResultsQueue: Array<Array<{ minOrder: number }>> = [
      [{ minOrder: 5 }],
      [{ minOrder: 2 }],
    ]

    mockDbSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => Promise.resolve(minResultsQueue.shift() ?? [])),
      }),
    }))

    let insertedValues: Record<string, unknown> | null = null
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockImplementation((values: Record<string, unknown>) => {
        insertedValues = values
        return Promise.resolve(undefined)
      }),
    })

    const req = createMockRequest('POST', {
      name: 'New Workflow',
      description: 'desc',
      color: '#3972F6',
      workspaceId: 'workspace-123',
      folderId: null,
    })

    const response = await POST(req)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.sortOrder).toBe(1)
    expect(insertedValues).not.toBeNull()
    expect(insertedValues?.sortOrder).toBe(1)
  })

  it('defaults to sortOrder 0 when there are no siblings', async () => {
    const minResultsQueue: Array<Array<{ minOrder: number }>> = [[], []]

    mockDbSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => Promise.resolve(minResultsQueue.shift() ?? [])),
      }),
    }))

    let insertedValues: Record<string, unknown> | null = null
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockImplementation((values: Record<string, unknown>) => {
        insertedValues = values
        return Promise.resolve(undefined)
      }),
    })

    const req = createMockRequest('POST', {
      name: 'New Workflow',
      description: 'desc',
      color: '#3972F6',
      workspaceId: 'workspace-123',
      folderId: null,
    })

    const response = await POST(req)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.sortOrder).toBe(0)
    expect(insertedValues?.sortOrder).toBe(0)
  })
})

describe('Workflows API Route - GET pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      userName: 'Test User',
      userEmail: 'test@example.com',
    })
    mockWorkspaceExists.mockResolvedValue(true)
    mockVerifyWorkspaceMembership.mockResolvedValue('member')
  })

  /**
   * Builds a fluent mock chain for db.select() that terminates with the
   * given resolved values. The chain supports arbitrary method calls
   * (from, where, orderBy, limit, offset) in any order.
   */
  function buildSelectChain(resolvedValues: unknown[]) {
    const chain: Record<string, unknown> = {}
    const self = new Proxy(chain, {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve(resolvedValues)
        }
        return vi.fn().mockReturnValue(self)
      },
    })
    return self
  }

  it('returns pagination metadata with workspace workflows', async () => {
    const mockWorkflows = [
      { id: 'wf-1', name: 'Workflow 1', workspaceId: 'ws-1' },
      { id: 'wf-2', name: 'Workflow 2', workspaceId: 'ws-1' },
    ]

    const selectCalls: unknown[][] = []
    mockDbSelect.mockImplementation((...args: unknown[]) => {
      selectCalls.push(args)
      if (selectCalls.length === 1) {
        return buildSelectChain([{ count: 2 }])
      }
      return buildSelectChain(mockWorkflows)
    })

    const req = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/workflows?workspaceId=ws-1'
    )

    const response = await GET(req as any)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data).toHaveLength(2)
    expect(json.pagination).toBeDefined()
    expect(json.pagination.total).toBe(2)
    expect(json.pagination.limit).toBe(200)
    expect(json.pagination.offset).toBe(0)
    expect(json.pagination.hasMore).toBe(false)
  })

  it('respects custom limit and offset params', async () => {
    const mockWorkflows = [{ id: 'wf-1', name: 'Workflow 1', workspaceId: 'ws-1' }]

    const selectCalls: unknown[][] = []
    mockDbSelect.mockImplementation((...args: unknown[]) => {
      selectCalls.push(args)
      if (selectCalls.length === 1) {
        return buildSelectChain([{ count: 5 }])
      }
      return buildSelectChain(mockWorkflows)
    })

    const req = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/workflows?workspaceId=ws-1&limit=1&offset=2'
    )

    const response = await GET(req as any)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.pagination.limit).toBe(1)
    expect(json.pagination.offset).toBe(2)
    expect(json.pagination.total).toBe(5)
    expect(json.pagination.hasMore).toBe(true)
  })

  it('clamps limit to MAX_PAGE_LIMIT', async () => {
    const selectCalls: unknown[][] = []
    mockDbSelect.mockImplementation((...args: unknown[]) => {
      selectCalls.push(args)
      if (selectCalls.length === 1) {
        return buildSelectChain([{ count: 0 }])
      }
      return buildSelectChain([])
    })

    const req = createMockRequest(
      'GET',
      undefined,
      {},
      'http://localhost:3000/api/workflows?workspaceId=ws-1&limit=9999'
    )

    const response = await GET(req as any)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.pagination.limit).toBe(500)
  })

  it('returns pagination in empty workspace response for no-workspace query', async () => {
    mockDbSelect.mockImplementation(() => buildSelectChain([]))

    const req = createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/workflows')

    const response = await GET(req as any)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data).toEqual([])
    expect(json.pagination).toBeDefined()
    expect(json.pagination.total).toBe(0)
    expect(json.pagination.hasMore).toBe(false)
  })
})
