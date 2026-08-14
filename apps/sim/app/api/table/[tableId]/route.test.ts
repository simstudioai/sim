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
vi.mock('@/lib/table/service', () => ({
  deleteTable: mockDeleteTable,
  getTableById: mockGetTableById,
  moveTableToFolder: mockMoveTableToFolder,
  renameTable: mockRenameTable,
  updateTableLocks: mockUpdateTableLocks,
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
  tableLockErrorResponse: () => null,
}))
vi.mock('@/lib/table/wire', () => ({
  normalizeColumn: (column: unknown) => column,
}))

import { GET, PATCH } from '@/app/api/table/[tableId]/route'

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
    mockMoveTableToFolder.mockResolvedValue({ name: 'Table' })
    mockRenameTable.mockResolvedValue({ id: 'tbl_1', name: 'Table' })
    mockDeleteTable.mockResolvedValue({ archived: { name: 'Table', workspaceId: 'workspace-1' } })
    mockUpdateTableLocks.mockResolvedValue({
      table: { ...TABLE, locks: {} },
      previousLocks: {},
    })
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
      expect.any(String)
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
      expect.any(String)
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
})

/**
 * Pins which auth path this route hands a Bearer token to.
 *
 * `fetchTableSchema` in `@/tools/schema-enrichers` reaches this route with a legacy
 * `type: 'internal'` token from the deprecated `buildAuthHeaders`. Only
 * `checkSessionOrInternalAuth` accepts that token; the delegation policy the sibling
 * table routes use rejects it outright. Migrating this route without moving that caller
 * to `buildExecutorDelegationHeaders` in the same change breaks every table tool on an
 * Agent block, so this fails first and names the caller.
 *
 * Scope: this pins the *route's* choice of verifier. That the legacy token is actually
 * valid for that verifier — and rejected by the delegation one — is pinned separately in
 * `@/lib/auth/internal.test.ts`. Both halves are needed; neither implies the other.
 */
describe('GET /api/table/[tableId] executor auth pairing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'internal_jwt',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
    mockGetLimits.mockResolvedValue({ maxRowsPerTable: 1000 })
  })

  it('routes a Bearer token to the legacy verifier fetchTableSchema mints for', async () => {
    const request = new NextRequest('http://localhost:3000/api/table/tbl_1?workspaceId=workspace-1')
    request.headers.set('authorization', 'Bearer legacy-internal-token')

    const response = await GET(request, routeContext)

    expect(response.status).toBe(200)
    expect(hybridAuthMockFns.mockCheckSessionOrInternalAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ get: expect.any(Function) }),
      }),
      expect.anything()
    )
    const [forwarded] = hybridAuthMockFns.mockCheckSessionOrInternalAuth.mock.calls[0]
    expect(forwarded.headers.get('authorization')).toBe('Bearer legacy-internal-token')
  })
})
