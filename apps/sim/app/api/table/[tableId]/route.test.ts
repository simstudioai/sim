/**
 * @vitest-environment node
 */
import { hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckAccess,
  mockDeleteTable,
  mockGetTableById,
  mockMoveTableToFolder,
  mockRenameTable,
  mockUpdateTableLocks,
  mockFindActiveFolder,
  mockGetLimits,
  mockGetUserEntityPermissions,
} = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockDeleteTable: vi.fn(),
  mockGetTableById: vi.fn(),
  mockMoveTableToFolder: vi.fn(),
  mockRenameTable: vi.fn(),
  mockUpdateTableLocks: vi.fn(),
  mockFindActiveFolder: vi.fn(),
  mockGetLimits: vi.fn(),
  mockGetUserEntityPermissions: vi.fn(),
}))

vi.mock('@/lib/table', () => ({
  deleteTable: mockDeleteTable,
  getTableById: mockGetTableById,
  moveTableToFolder: mockMoveTableToFolder,
  renameTable: mockRenameTable,
  updateTableLocks: mockUpdateTableLocks,
  TableConflictError: class extends Error {},
}))
vi.mock('@/lib/table/billing', () => ({ getWorkspaceTableLimits: mockGetLimits }))
vi.mock('@/lib/folders/queries', () => ({ findActiveFolder: mockFindActiveFolder }))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: vi.fn() }))
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))
vi.mock('@/lib/workspaces/permissions/utils', () => ({
  getWorkspaceWithOwner: vi.fn(),
  getUserEntityPermissions: mockGetUserEntityPermissions,
}))
vi.mock('@/app/api/table/utils', () => ({
  accessError: (result: { status: number }) => new Response('denied', { status: result.status }),
  checkAccess: mockCheckAccess,
  normalizeColumn: (column: unknown) => column,
  tableLockErrorResponse: () => null,
}))

import { DELETE, GET, PATCH } from '@/app/api/table/[tableId]/route'

const TABLE = {
  id: 'tbl_1',
  name: 'people',
  workspaceId: 'workspace-1',
  folderId: null as string | null,
  schema: { columns: [] },
  locks: {
    schemaLocked: false,
    insertLocked: false,
    updateLocked: false,
    deleteLocked: false,
  },
}

function patchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/table/tbl_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const routeContext = { params: Promise.resolve({ tableId: 'tbl_1' }) }

describe('GET /api/table/[tableId] Memory table', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockGetUserEntityPermissions.mockResolvedValue('read')
    mockCheckAccess.mockResolvedValue({
      ok: true,
      table: {
        ...TABLE,
        id: 'system_memory_workspace-1',
        name: 'Memory',
        isVirtual: true,
        rowCount: 1,
        maxRows: Number.MAX_SAFE_INTEGER,
        createdBy: 'user-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        locks: {
          schemaLocked: true,
          insertLocked: true,
          updateLocked: true,
          deleteLocked: true,
        },
      },
    })
    mockGetLimits.mockResolvedValue({ maxRowsPerTable: 10_000 })
  })

  it('returns the synthetic table to a workspace reader', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/table/system_memory_workspace-1?workspaceId=workspace-1'
      ),
      { params: Promise.resolve({ tableId: 'system_memory_workspace-1' }) }
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.table).toMatchObject({
      id: 'system_memory_workspace-1',
      name: 'Memory',
      isVirtual: true,
      rowCount: 1,
      maxRows: 10_000,
    })
    expect(mockCheckAccess).toHaveBeenCalledWith('system_memory_workspace-1', 'user-1', 'read')
    expect(mockGetLimits).toHaveBeenCalledWith('workspace-1')
  })

  it('does not expose the table to someone outside the workspace', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const response = await GET(
      new NextRequest(
        'http://localhost:3000/api/table/system_memory_workspace-1?workspaceId=workspace-1'
      ),
      { params: Promise.resolve({ tableId: 'system_memory_workspace-1' }) }
    )

    expect(response.status).toBe(403)
    expect(mockGetLimits).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/table/[tableId] folder moves', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
    mockGetTableById.mockResolvedValue({ ...TABLE, folderId: 'folder-1' })
    mockFindActiveFolder.mockResolvedValue({ id: 'folder-1' })
  })

  it('moves the table into a folder in the same workspace and tree', async () => {
    const response = await PATCH(
      patchRequest({ workspaceId: 'workspace-1', folderId: 'folder-1' }),
      routeContext
    )

    expect(response.status).toBe(200)
    expect(mockFindActiveFolder).toHaveBeenCalledWith('folder-1', 'workspace-1', 'table')
    expect(mockMoveTableToFolder).toHaveBeenCalledWith(
      'tbl_1',
      'workspace-1',
      'folder-1',
      expect.any(String),
      'user-1'
    )
  })

  it('moves the table to the workspace root on an explicit null, with no folder lookup', async () => {
    mockGetTableById.mockResolvedValue({ ...TABLE, folderId: null })

    const response = await PATCH(
      patchRequest({ workspaceId: 'workspace-1', folderId: null }),
      routeContext
    )

    expect(response.status).toBe(200)
    expect(mockFindActiveFolder).not.toHaveBeenCalled()
    expect(mockMoveTableToFolder).toHaveBeenCalledWith(
      'tbl_1',
      'workspace-1',
      null,
      expect.any(String),
      'user-1'
    )
  })

  it('leaves placement untouched when folderId is omitted', async () => {
    await PATCH(patchRequest({ workspaceId: 'workspace-1', name: 'renamed' }), routeContext)

    expect(mockRenameTable).toHaveBeenCalled()
    expect(mockMoveTableToFolder).not.toHaveBeenCalled()
  })

  it('rejects a folder from another workspace or resource tree without writing', async () => {
    mockFindActiveFolder.mockResolvedValue(null)

    const response = await PATCH(
      patchRequest({ workspaceId: 'workspace-1', folderId: 'kb-folder' }),
      routeContext
    )

    expect(response.status).toBe(404)
    expect(mockMoveTableToFolder).not.toHaveBeenCalled()
  })

  it('rejects a body with no name, folder, or lock changes', async () => {
    const response = await PATCH(patchRequest({ workspaceId: 'workspace-1' }), routeContext)

    expect(response.status).toBe(400)
    expect(mockMoveTableToFolder).not.toHaveBeenCalled()
    expect(mockRenameTable).not.toHaveBeenCalled()
  })

  it('rejects synthetic Memory table writes with a read-only explanation', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 423 })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/table/system_memory_workspace-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId: 'workspace-1', name: 'Renamed' }),
      }),
      { params: Promise.resolve({ tableId: 'system_memory_workspace-1' }) }
    )

    expect(response.status).toBe(423)
    expect(mockCheckAccess).toHaveBeenCalledWith('system_memory_workspace-1', 'user-1', 'write')
    expect(mockRenameTable).not.toHaveBeenCalled()
    expect(mockUpdateTableLocks).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/table/[tableId] Memory table', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
  })

  it('rejects deletion through shared access', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 423 })
    const tableId = 'system_memory_workspace-1'
    const response = await DELETE(
      new NextRequest(`http://localhost:3000/api/table/${tableId}?workspaceId=workspace-1`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ tableId }) }
    )

    expect(response.status).toBe(423)
    expect(mockCheckAccess).toHaveBeenCalledWith(tableId, 'user-1', 'write')
    expect(mockDeleteTable).not.toHaveBeenCalled()
  })
})
