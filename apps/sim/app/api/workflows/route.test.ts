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
} = vi.hoisted(() => ({
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
  mockWorkflowCreated: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({
  ...drizzleOrmMock,
  min: vi.fn((field) => ({ type: 'min', field })),
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
  workspaceExists: vi.fn(),
}))

vi.mock('@/app/api/workflows/utils', () => ({
  verifyWorkspaceMembership: vi.fn(),
}))

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: {
    workflowCreated: (...args: unknown[]) => mockWorkflowCreated(...args),
  },
}))

import { POST } from '@/app/api/workflows/route'

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
