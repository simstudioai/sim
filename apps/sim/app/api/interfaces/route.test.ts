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
import type { InterfaceDefinition } from '@/lib/interfaces'

const {
  mockCreateInterface,
  mockGetInterfaceById,
  mockListInterfaces,
  mockRecordAudit,
  InterfaceConflictErrorMock,
  InterfaceLayoutErrorMock,
  InterfaceStaleWriteErrorMock,
  InvalidModuleReferenceErrorMock,
} = vi.hoisted(() => {
  class InterfaceConflictErrorMock extends Error {
    readonly code = 'INTERFACE_EXISTS' as const
  }
  class InterfaceStaleWriteErrorMock extends Error {
    readonly code = 'INTERFACE_STALE_WRITE' as const
  }
  class InterfaceLayoutErrorMock extends Error {
    readonly code = 'INVALID_INTERFACE_LAYOUT' as const
    readonly errors: string[]
    constructor(errors: string[]) {
      super(errors.join('; '))
      this.errors = errors
    }
  }
  class InvalidModuleReferenceErrorMock extends Error {
    readonly code = 'INVALID_MODULE_REFERENCE' as const
  }
  return {
    mockCreateInterface: vi.fn(),
    mockGetInterfaceById: vi.fn(),
    mockListInterfaces: vi.fn(),
    mockRecordAudit: vi.fn(),
    InterfaceConflictErrorMock,
    InterfaceLayoutErrorMock,
    InterfaceStaleWriteErrorMock,
    InvalidModuleReferenceErrorMock,
  }
})

vi.mock('@/lib/interfaces', () => ({
  createInterface: mockCreateInterface,
  getInterfaceById: mockGetInterfaceById,
  listInterfaces: mockListInterfaces,
  InterfaceConflictError: InterfaceConflictErrorMock,
  InterfaceLayoutError: InterfaceLayoutErrorMock,
  InterfaceStaleWriteError: InterfaceStaleWriteErrorMock,
  InvalidModuleReferenceError: InvalidModuleReferenceErrorMock,
}))

vi.mock('@sim/audit', () => ({
  recordAudit: mockRecordAudit,
  AuditAction: {
    INTERFACE_CREATED: 'interface.created',
    INTERFACE_UPDATED: 'interface.updated',
    INTERFACE_DELETED: 'interface.deleted',
    INTERFACE_RESTORED: 'interface.restored',
  },
  AuditResourceType: { INTERFACE: 'interface' },
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { GET, POST } from '@/app/api/interfaces/route'

function buildDefinition(overrides: Partial<InterfaceDefinition> = {}): InterfaceDefinition {
  return {
    id: 'int-1',
    workspaceId: 'ws-1',
    name: 'Support desk',
    description: null,
    layout: { version: 1, modules: [] },
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    ...overrides,
  }
}

function callGet(query = 'workspaceId=ws-1') {
  return GET(
    createMockRequest('GET', undefined, {}, `http://localhost:3000/api/interfaces?${query}`),
    {}
  )
}

function callPost(body: Record<string, unknown>) {
  return POST(createMockRequest('POST', body, {}, 'http://localhost:3000/api/interfaces'), {})
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
  mockListInterfaces.mockResolvedValue([buildDefinition()])
  mockCreateInterface.mockResolvedValue(buildDefinition())
})

describe('GET /api/interfaces', () => {
  it('returns 401 when unauthenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: false,
      error: 'Unauthorized',
    })

    const response = await callGet()

    expect(response.status).toBe(401)
    expect(mockListInterfaces).not.toHaveBeenCalled()
  })

  it('returns 403 when the user has no workspace permission', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue(null)

    const response = await callGet()

    expect(response.status).toBe(403)
    expect(mockListInterfaces).not.toHaveBeenCalled()
  })

  it('lists interfaces for a read-only member and defaults the scope to active', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')

    const response = await callGet()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { interfaces: [buildDefinition()] },
    })
    expect(mockListInterfaces).toHaveBeenCalledWith('ws-1', { scope: 'active' })
  })

  it('forwards the archived scope', async () => {
    mockListInterfaces.mockResolvedValue([])

    const response = await callGet('workspaceId=ws-1&scope=archived')

    expect(response.status).toBe(200)
    expect(mockListInterfaces).toHaveBeenCalledWith('ws-1', { scope: 'archived' })
  })

  it('returns 400 when workspaceId is missing', async () => {
    const response = await callGet('')

    expect(response.status).toBe(400)
    expect(mockListInterfaces).not.toHaveBeenCalled()
  })
})

describe('POST /api/interfaces', () => {
  it('returns 401 before validating the body', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: false,
      error: 'Unauthorized',
    })

    const response = await callPost({})

    expect(response.status).toBe(401)
    expect(mockCreateInterface).not.toHaveBeenCalled()
  })

  it('returns 403 for a read-only member', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')

    const response = await callPost({ workspaceId: 'ws-1', name: 'Support desk' })

    expect(response.status).toBe(403)
    expect(mockCreateInterface).not.toHaveBeenCalled()
  })

  it('returns 400 when the name is missing', async () => {
    const response = await callPost({ workspaceId: 'ws-1' })

    expect(response.status).toBe(400)
    expect(mockCreateInterface).not.toHaveBeenCalled()
  })

  it('creates the interface and records an audit entry', async () => {
    const response = await callPost({
      workspaceId: 'ws-1',
      name: 'Support desk',
      description: 'Front desk',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, data: buildDefinition() })
    expect(mockCreateInterface).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      name: 'Support desk',
      description: 'Front desk',
      createdBy: 'user-1',
    })
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        actorId: 'user-1',
        action: 'interface.created',
        resourceType: 'interface',
        resourceId: 'int-1',
        resourceName: 'Support desk',
        description: 'Created interface "Support desk"',
      })
    )
  })

  it('returns 409 when the name is already taken', async () => {
    mockCreateInterface.mockRejectedValue(
      new InterfaceConflictErrorMock('An interface named "Support desk" already exists')
    )

    const response = await callPost({ workspaceId: 'ws-1', name: 'Support desk' })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'An interface named "Support desk" already exists',
    })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('returns 500 on an unexpected failure', async () => {
    mockCreateInterface.mockRejectedValue(new Error('connection reset'))

    const response = await callPost({ workspaceId: 'ws-1', name: 'Support desk' })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to create interface' })
  })
})
