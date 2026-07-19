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
import type { InterfaceDefinition, InterfaceLayout } from '@/lib/interfaces'

const {
  mockDeleteInterface,
  mockGetInterfaceById,
  mockRecordAudit,
  mockRenameInterface,
  mockUpdateInterfaceDescription,
  mockUpdateInterfaceLayout,
  mockValidateLayout,
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
    mockDeleteInterface: vi.fn(),
    mockGetInterfaceById: vi.fn(),
    mockRecordAudit: vi.fn(),
    mockRenameInterface: vi.fn(),
    mockUpdateInterfaceDescription: vi.fn(),
    mockUpdateInterfaceLayout: vi.fn(),
    mockValidateLayout: vi.fn(),
    InterfaceConflictErrorMock,
    InterfaceLayoutErrorMock,
    InterfaceStaleWriteErrorMock,
    InvalidModuleReferenceErrorMock,
  }
})

vi.mock('@/lib/interfaces', () => ({
  deleteInterface: mockDeleteInterface,
  getInterfaceById: mockGetInterfaceById,
  renameInterface: mockRenameInterface,
  updateInterfaceDescription: mockUpdateInterfaceDescription,
  updateInterfaceLayout: mockUpdateInterfaceLayout,
  validateLayout: mockValidateLayout,
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

import { DELETE, GET, PATCH } from '@/app/api/interfaces/[interfaceId]/route'

const EMPTY_LAYOUT: InterfaceLayout = { version: 1, modules: [] }

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
    archivedAt: null,
    ...overrides,
  }
}

const routeContext = { params: Promise.resolve({ interfaceId: 'int-1' }) }

function callGet(query = 'workspaceId=ws-1') {
  return GET(
    createMockRequest('GET', undefined, {}, `http://localhost:3000/api/interfaces/int-1?${query}`),
    routeContext
  )
}

function callPatch(body: Record<string, unknown>) {
  return PATCH(
    createMockRequest('PATCH', body, {}, 'http://localhost:3000/api/interfaces/int-1'),
    routeContext
  )
}

function callDelete(query = 'workspaceId=ws-1') {
  return DELETE(
    createMockRequest(
      'DELETE',
      undefined,
      {},
      `http://localhost:3000/api/interfaces/int-1?${query}`
    ),
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
  mockRenameInterface.mockResolvedValue(buildDefinition({ name: 'Renamed' }))
  mockUpdateInterfaceDescription.mockResolvedValue(buildDefinition({ description: 'Notes' }))
  mockUpdateInterfaceLayout.mockResolvedValue(buildDefinition())
  mockValidateLayout.mockResolvedValue(undefined)
  mockDeleteInterface.mockResolvedValue(undefined)
})

describe('GET /api/interfaces/[interfaceId]', () => {
  it('returns 401 when unauthenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: false,
      error: 'Unauthorized',
    })

    const response = await callGet()

    expect(response.status).toBe(401)
    expect(mockGetInterfaceById).not.toHaveBeenCalled()
  })

  it('returns the interface for a read-only member', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')

    const response = await callGet()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, data: buildDefinition() })
    expect(mockGetInterfaceById).toHaveBeenCalledWith('int-1', { includeArchived: false })
  })

  it('returns 404 when the interface does not exist', async () => {
    mockGetInterfaceById.mockResolvedValue(null)

    const response = await callGet()

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Interface not found' })
  })

  it('returns 404 when the interface belongs to another workspace', async () => {
    mockGetInterfaceById.mockResolvedValue(buildDefinition({ workspaceId: 'ws-other' }))

    const response = await callGet()

    expect(response.status).toBe(404)
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })

  it('returns 403 when the user has no workspace permission', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue(null)

    const response = await callGet()

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' })
  })
})

describe('PATCH /api/interfaces/[interfaceId]', () => {
  it('returns 401 before validating the body', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: false,
      error: 'Unauthorized',
    })

    const response = await callPatch({})

    expect(response.status).toBe(401)
    expect(mockGetInterfaceById).not.toHaveBeenCalled()
  })

  it('returns 400 when no updatable field is supplied', async () => {
    const response = await callPatch({ workspaceId: 'ws-1' })

    expect(response.status).toBe(400)
    expect(mockRenameInterface).not.toHaveBeenCalled()
  })

  it('returns 403 for a read-only member', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')

    const response = await callPatch({ workspaceId: 'ws-1', name: 'Renamed' })

    expect(response.status).toBe(403)
    expect(mockRenameInterface).not.toHaveBeenCalled()
  })

  it('returns 404 when the interface belongs to another workspace', async () => {
    mockGetInterfaceById.mockResolvedValue(buildDefinition({ workspaceId: 'ws-other' }))

    const response = await callPatch({ workspaceId: 'ws-1', name: 'Renamed' })

    expect(response.status).toBe(404)
    expect(mockRenameInterface).not.toHaveBeenCalled()
  })

  it('applies name, description, and layout in order and returns the last result', async () => {
    const finalDefinition = buildDefinition({ name: 'Renamed', description: 'Notes' })
    mockUpdateInterfaceLayout.mockResolvedValue(finalDefinition)

    const response = await callPatch({
      workspaceId: 'ws-1',
      name: 'Renamed',
      description: 'Notes',
      layout: EMPTY_LAYOUT,
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, data: finalDefinition })
    expect(mockRenameInterface).toHaveBeenCalledWith('int-1', 'Renamed')
    expect(mockUpdateInterfaceDescription).toHaveBeenCalledWith('int-1', 'Notes')
    expect(mockUpdateInterfaceLayout).toHaveBeenCalledWith('int-1', EMPTY_LAYOUT, {
      expectedUpdatedAt: undefined,
    })
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'interface.updated',
        resourceType: 'interface',
        resourceId: 'int-1',
        resourceName: 'Renamed',
        description: 'Updated interface "Renamed"',
      })
    )
  })

  it('rejects a multi-field patch before any writer runs when the layout is invalid', async () => {
    mockValidateLayout.mockRejectedValue(
      new InvalidModuleReferenceErrorMock('Table "tbl-1" was not found in this workspace')
    )

    const response = await callPatch({
      workspaceId: 'ws-1',
      name: 'Renamed',
      layout: EMPTY_LAYOUT,
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Table "tbl-1" was not found in this workspace',
    })
    expect(mockValidateLayout).toHaveBeenCalledWith('ws-1', EMPTY_LAYOUT)
    expect(mockRenameInterface).not.toHaveBeenCalled()
    expect(mockUpdateInterfaceLayout).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('skips the pre-check for a layout-only patch so the hot autosave path validates once', async () => {
    const response = await callPatch({ workspaceId: 'ws-1', layout: EMPTY_LAYOUT })

    expect(response.status).toBe(200)
    expect(mockValidateLayout).not.toHaveBeenCalled()
    expect(mockUpdateInterfaceLayout).toHaveBeenCalledWith('int-1', EMPTY_LAYOUT, {
      expectedUpdatedAt: undefined,
    })
  })

  it('conflicts on the name before the layout is committed', async () => {
    mockRenameInterface.mockRejectedValue(
      new InterfaceConflictErrorMock('An interface named "Renamed" already exists')
    )

    const response = await callPatch({
      workspaceId: 'ws-1',
      name: 'Renamed',
      layout: EMPTY_LAYOUT,
    })

    expect(response.status).toBe(409)
    expect(mockUpdateInterfaceLayout).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('treats a null description as a clear and leaves an omitted one untouched', async () => {
    mockUpdateInterfaceDescription.mockResolvedValue(buildDefinition({ description: null }))

    const response = await callPatch({ workspaceId: 'ws-1', description: null })

    expect(response.status).toBe(200)
    expect(mockUpdateInterfaceDescription).toHaveBeenCalledWith('int-1', null)
    expect(mockRenameInterface).not.toHaveBeenCalled()
    expect(mockUpdateInterfaceLayout).not.toHaveBeenCalled()
  })

  it('returns 400 with the per-error details when the layout is invalid', async () => {
    mockUpdateInterfaceLayout.mockRejectedValue(
      new InterfaceLayoutErrorMock(['Cell (0, 0) is already occupied'])
    )

    const response = await callPatch({ workspaceId: 'ws-1', layout: EMPTY_LAYOUT })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Cell (0, 0) is already occupied',
      details: ['Cell (0, 0) is already occupied'],
    })
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('returns 400 when a module references a resource outside the workspace', async () => {
    mockUpdateInterfaceLayout.mockRejectedValue(
      new InvalidModuleReferenceErrorMock('Workflow "wf-1" was not found in this workspace')
    )

    const response = await callPatch({ workspaceId: 'ws-1', layout: EMPTY_LAYOUT })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Workflow "wf-1" was not found in this workspace',
    })
  })

  it('returns 409 when the new name is already taken', async () => {
    mockRenameInterface.mockRejectedValue(
      new InterfaceConflictErrorMock('An interface named "Renamed" already exists')
    )

    const response = await callPatch({ workspaceId: 'ws-1', name: 'Renamed' })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'An interface named "Renamed" already exists',
    })
  })

  it('forwards expectedUpdatedAt to the layout writer as the precondition', async () => {
    const response = await callPatch({
      workspaceId: 'ws-1',
      layout: EMPTY_LAYOUT,
      expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(response.status).toBe(200)
    expect(mockUpdateInterfaceLayout).toHaveBeenCalledWith('int-1', EMPTY_LAYOUT, {
      expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('returns 409 with the stale-write code and commits nothing when the precondition fails', async () => {
    mockUpdateInterfaceLayout.mockRejectedValue(
      new InterfaceStaleWriteErrorMock(
        'This interface was changed by someone else. Reload to get the latest version.'
      )
    )

    const response = await callPatch({
      workspaceId: 'ws-1',
      layout: EMPTY_LAYOUT,
      expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'This interface was changed by someone else. Reload to get the latest version.',
      code: 'INTERFACE_STALE_WRITE',
    })
    expect(mockRenameInterface).not.toHaveBeenCalled()
    expect(mockUpdateInterfaceDescription).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('drops the precondition when an earlier writer in the same request bumped updatedAt', async () => {
    const response = await callPatch({
      workspaceId: 'ws-1',
      name: 'Renamed',
      layout: EMPTY_LAYOUT,
      expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(response.status).toBe(200)
    expect(mockRenameInterface).toHaveBeenCalledWith('int-1', 'Renamed')
    expect(mockUpdateInterfaceLayout).toHaveBeenCalledWith('int-1', EMPTY_LAYOUT, {
      expectedUpdatedAt: undefined,
    })
  })

  it('returns 400 for an expectedUpdatedAt without a layout', async () => {
    const response = await callPatch({
      workspaceId: 'ws-1',
      name: 'Renamed',
      expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(response.status).toBe(400)
    expect(mockRenameInterface).not.toHaveBeenCalled()
  })

  it('returns 400 for a non-ISO expectedUpdatedAt', async () => {
    const response = await callPatch({
      workspaceId: 'ws-1',
      layout: EMPTY_LAYOUT,
      expectedUpdatedAt: 'yesterday',
    })

    expect(response.status).toBe(400)
    expect(mockUpdateInterfaceLayout).not.toHaveBeenCalled()
  })

  it('rejects a layout with two modules in the same cell', async () => {
    const duplicateCellLayout = {
      version: 1,
      modules: [
        { id: 'm-1', type: 'table', cell: { row: 0, col: 0 }, config: { tableId: null } },
        { id: 'm-2', type: 'file', cell: { row: 0, col: 0 }, config: { fileId: null } },
      ],
    }

    const response = await callPatch({ workspaceId: 'ws-1', layout: duplicateCellLayout })

    expect(response.status).toBe(400)
    expect(mockUpdateInterfaceLayout).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/interfaces/[interfaceId]', () => {
  it('returns 401 when unauthenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: false,
      error: 'Unauthorized',
    })

    const response = await callDelete()

    expect(response.status).toBe(401)
    expect(mockDeleteInterface).not.toHaveBeenCalled()
  })

  it('returns 403 for a read-only member', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')

    const response = await callDelete()

    expect(response.status).toBe(403)
    expect(mockDeleteInterface).not.toHaveBeenCalled()
  })

  it('returns 404 when the interface belongs to another workspace', async () => {
    mockGetInterfaceById.mockResolvedValue(buildDefinition({ workspaceId: 'ws-other' }))

    const response = await callDelete()

    expect(response.status).toBe(404)
    expect(mockDeleteInterface).not.toHaveBeenCalled()
  })

  it('archives the interface and records an audit entry', async () => {
    const response = await callDelete()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, data: { id: 'int-1' } })
    expect(mockDeleteInterface).toHaveBeenCalledWith('int-1')
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'interface.deleted',
        resourceType: 'interface',
        resourceId: 'int-1',
        resourceName: 'Support desk',
        description: 'Deleted interface "Support desk"',
      })
    )
  })
})
