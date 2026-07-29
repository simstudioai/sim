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
} = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockDeleteTable: vi.fn(),
  mockGetTableById: vi.fn(),
  mockMoveTableToFolder: vi.fn(),
  mockRenameTable: vi.fn(),
  mockUpdateTableLocks: vi.fn(),
  mockFindActiveFolder: vi.fn(),
  mockGetLimits: vi.fn(),
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
  getUserEntityPermissions: vi.fn(),
}))
vi.mock('@/app/api/table/utils', () => ({
  accessError: () => new Response('denied', { status: 403 }),
  checkAccess: mockCheckAccess,
  normalizeColumn: (column: unknown) => column,
  tableLockErrorResponse: () => null,
}))

import { PATCH } from '@/app/api/table/[tableId]/route'

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
    expect(mockMoveTableToFolder).toHaveBeenCalledWith('tbl_1', null, expect.any(String), 'user-1')
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
})
