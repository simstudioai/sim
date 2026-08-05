/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  hybridAuthMockFns,
  permissionsMock,
  permissionsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InterfaceDefinition, InterfaceLayout } from '@/lib/interfaces/types'

const {
  mockGetInterfaceById,
  mockRecordAudit,
  mockRestoreInterface,
  InterfaceConflictErrorMock,
  InterfaceNotArchivedErrorMock,
  InterfaceNotFoundErrorMock,
  InterfaceStaleWriteErrorMock,
  InterfaceWorkspaceArchivedErrorMock,
} = vi.hoisted(() => {
  class InterfaceConflictErrorMock extends Error {
    readonly code = 'INTERFACE_EXISTS' as const
  }
  class InterfaceStaleWriteErrorMock extends Error {
    readonly code = 'INTERFACE_STALE_WRITE' as const
  }
  class InterfaceNotFoundErrorMock extends Error {
    readonly code = 'INTERFACE_NOT_FOUND' as const
  }
  class InterfaceNotArchivedErrorMock extends Error {
    readonly code = 'INTERFACE_NOT_ARCHIVED' as const
  }
  class InterfaceWorkspaceArchivedErrorMock extends Error {
    readonly code = 'INTERFACE_WORKSPACE_ARCHIVED' as const
  }
  return {
    mockGetInterfaceById: vi.fn(),
    mockRecordAudit: vi.fn(),
    mockRestoreInterface: vi.fn(),
    InterfaceConflictErrorMock,
    InterfaceNotArchivedErrorMock,
    InterfaceNotFoundErrorMock,
    InterfaceStaleWriteErrorMock,
    InterfaceWorkspaceArchivedErrorMock,
  }
})

/**
 * Mocked at the service leaf rather than the `@/lib/interfaces` barrel so the
 * orchestration layer — and therefore the audit record the route relies on —
 * runs for real.
 */
vi.mock('@/lib/interfaces/service', () => ({
  getInterfaceById: mockGetInterfaceById,
  restoreInterface: mockRestoreInterface,
  InterfaceConflictError: InterfaceConflictErrorMock,
  InterfaceNotArchivedError: InterfaceNotArchivedErrorMock,
  InterfaceNotFoundError: InterfaceNotFoundErrorMock,
  InterfaceStaleWriteError: InterfaceStaleWriteErrorMock,
  InterfaceWorkspaceArchivedError: InterfaceWorkspaceArchivedErrorMock,
}))

vi.mock('@/lib/table', () => ({ getTableById: vi.fn() }))

vi.mock('@sim/audit', () => ({
  recordAudit: mockRecordAudit,
  AuditAction: { INTERFACE_RESTORED: 'interface.restored' },
  AuditResourceType: { INTERFACE: 'interface' },
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { POST } from '@/app/api/interfaces/[interfaceId]/restore/route'

const EMPTY_LAYOUT: InterfaceLayout = { version: 1, grid: { rows: 2, cols: 2 }, modules: [] }

function buildDefinition(overrides: Partial<InterfaceDefinition> = {}): InterfaceDefinition {
  return {
    id: 'int-1',
    workspaceId: 'ws-1',
    name: 'Support desk',
    description: null,
    layout: EMPTY_LAYOUT,
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

const routeContext = { params: Promise.resolve({ interfaceId: 'int-1' }) }

function callPost(body: Record<string, unknown> = { workspaceId: 'ws-1' }) {
  return POST(
    createMockRequest('POST', body, {}, 'http://localhost:3000/api/interfaces/int-1/restore'),
    routeContext
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
    success: true,
    userId: 'user-1',
    userName: 'Ada',
    userEmail: 'ada@sim.ai',
    authType: 'session',
  })
  permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('admin')
  mockGetInterfaceById.mockResolvedValue(buildDefinition())
  mockRestoreInterface.mockResolvedValue(buildDefinition({ archivedAt: null }))
})

describe('POST /api/interfaces/[interfaceId]/restore', () => {
  it('returns 401 when unauthenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: false,
      error: 'Unauthorized',
    })

    const response = await callPost()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' })
    expect(mockGetInterfaceById).not.toHaveBeenCalled()
    expect(mockRestoreInterface).not.toHaveBeenCalled()
  })

  it('returns 400 when the workspace is missing from the body', async () => {
    const response = await callPost({})

    expect(response.status).toBe(400)
    expect(mockRestoreInterface).not.toHaveBeenCalled()
  })

  it('returns 403 for a read-only member', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')

    const response = await callPost()

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' })
    expect(mockRestoreInterface).not.toHaveBeenCalled()
  })

  it('returns 404 when the interface belongs to another workspace', async () => {
    mockGetInterfaceById.mockResolvedValue(buildDefinition({ workspaceId: 'ws-other' }))

    const response = await callPost()

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Interface not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
    expect(mockRestoreInterface).not.toHaveBeenCalled()
  })

  it('restores the archived interface and records an audit entry', async () => {
    const restored = buildDefinition({ archivedAt: null })

    const response = await callPost()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, data: restored })
    expect(mockGetInterfaceById).toHaveBeenCalledWith('int-1', { includeArchived: true })
    expect(mockRestoreInterface).toHaveBeenCalledWith('int-1')
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        actorName: 'Ada',
        actorEmail: 'ada@sim.ai',
        action: 'interface.restored',
        resourceType: 'interface',
        resourceId: 'int-1',
        resourceName: 'Support desk',
        description: 'Restored interface "Support desk"',
      })
    )
  })

  it('returns the suffixed name when the original was reclaimed while archived', async () => {
    mockRestoreInterface.mockResolvedValue(
      buildDefinition({ name: 'Support desk_restored', archivedAt: null })
    )

    const response = await callPost()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { name: 'Support desk_restored' },
    })
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceName: 'Support desk_restored',
        description: 'Restored interface "Support desk_restored"',
      })
    )
  })

  it('returns 409 when the interface is already active', async () => {
    mockRestoreInterface.mockRejectedValue(
      new InterfaceNotArchivedErrorMock('Interface is not archived')
    )

    const response = await callPost()

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Interface is not archived',
      code: 'INTERFACE_NOT_ARCHIVED',
    })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('returns 409 when the owning workspace is archived', async () => {
    mockRestoreInterface.mockRejectedValue(
      new InterfaceWorkspaceArchivedErrorMock('Cannot restore interface into an archived workspace')
    )

    const response = await callPost()

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Cannot restore interface into an archived workspace',
      code: 'INTERFACE_WORKSPACE_ARCHIVED',
    })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('returns 409 when no conflict-free restore name can be claimed', async () => {
    mockRestoreInterface.mockRejectedValue(
      new InterfaceConflictErrorMock('An interface named "Support desk" already exists')
    )

    const response = await callPost()

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'An interface named "Support desk" already exists',
    })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('returns 404 when the record vanishes between the access check and the restore', async () => {
    mockRestoreInterface.mockRejectedValue(new InterfaceNotFoundErrorMock('Interface not found'))

    const response = await callPost()

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Interface not found' })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('returns 500 for an unexpected failure', async () => {
    mockRestoreInterface.mockRejectedValue(new Error('connection terminated'))

    const response = await callPost()

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to restore interface' })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })
})
