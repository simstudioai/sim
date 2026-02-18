/**
 * @vitest-environment node
 */
import { auditMock, createMockRequest, mockConsoleLogger, setupCommonApiMocks } from '@sim/testing'
import { drizzleOrmMock } from '@sim/testing/mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockCheckSessionOrInternalAuth = vi.fn()
const mockGetUserEntityPermissions = vi.fn()
const mockDbSelect = vi.fn()
const mockDbInsert = vi.fn()
const mockWorkflowCreated = vi.fn()

vi.mock('drizzle-orm', () => ({
  ...drizzleOrmMock,
  min: vi.fn((field) => ({ type: 'min', field })),
}))

vi.mock('@/lib/audit/log', () => auditMock)

describe('Workflows API Route - POST ordering', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    setupCommonApiMocks()
    mockConsoleLogger()

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

    vi.doMock('@sim/db', () => ({
      db: {
        select: (...args: unknown[]) => mockDbSelect(...args),
        insert: (...args: unknown[]) => mockDbInsert(...args),
      },
    }))

    vi.doMock('@/lib/auth/hybrid', () => ({
      checkSessionOrInternalAuth: (...args: unknown[]) => mockCheckSessionOrInternalAuth(...args),
    }))

    vi.doMock('@/lib/workspaces/permissions/utils', () => ({
      getUserEntityPermissions: (...args: unknown[]) => mockGetUserEntityPermissions(...args),
      workspaceExists: vi.fn(),
    }))

    vi.doMock('@/app/api/workflows/utils', () => ({
      verifyWorkspaceMembership: vi.fn(),
    }))

    vi.doMock('@/lib/core/telemetry', () => ({
      PlatformEvents: {
        workflowCreated: (...args: unknown[]) => mockWorkflowCreated(...args),
      },
    }))
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

    const { POST } = await import('@/app/api/workflows/route')
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

    const { POST } = await import('@/app/api/workflows/route')
    const response = await POST(req)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.sortOrder).toBe(0)
    expect(insertedValues?.sortOrder).toBe(0)
  })
})
