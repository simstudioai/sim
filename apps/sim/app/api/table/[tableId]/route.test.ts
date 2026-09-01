/**
 * @vitest-environment node
 */
import { hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'

const {
  mockCheckAccess,
  mockDeleteTable,
  mockGetTableById,
  mockMoveTableToFolder,
  mockRenameTable,
  mockUpdateTableLocks,
  mockFindActiveFolder,
  mockGetLimits,
  mockAuthenticate,
  mockAuthenticateWithTransport,
  mockReadTable,
} = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockDeleteTable: vi.fn(),
  mockGetTableById: vi.fn(),
  mockMoveTableToFolder: vi.fn(),
  mockRenameTable: vi.fn(),
  mockUpdateTableLocks: vi.fn(),
  mockFindActiveFolder: vi.fn(),
  mockGetLimits: vi.fn(),
  mockAuthenticate: vi.fn(),
  mockAuthenticateWithTransport: vi.fn(),
  mockReadTable: vi.fn(),
}))

vi.mock('@/lib/table/api', () => ({
  internalTableSessionOrExecutorAuth: {
    authenticate: mockAuthenticate,
    authenticateWithTransport: mockAuthenticateWithTransport,
  },
  internalTableErrorPolicies: {
    concealTableAuthorization: { project: () => null },
  },
}))
vi.mock('@/lib/table/application/tables', () => ({
  readTableDetailsUseCase: { operation: { id: 'tables.read' }, execute: mockReadTable },
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
  toWireTimestamp: (value: Date) => value.toISOString(),
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

describe('GET /api/table/[tableId] application adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const principal = createTestRuntimePrincipal({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      executionId: 'execution-1',
      rootWorkflowId: 'workflow-1',
    })
    mockAuthenticate.mockResolvedValue(principal)
    mockAuthenticateWithTransport.mockResolvedValue({
      principal,
      transport: 'executor_jwt',
      executionWorkspaceId: 'workspace-canonical',
    })
    mockReadTable.mockResolvedValue({
      table: {
        ...TABLE,
        description: null,
        metadata: null,
        rowCount: 0,
        createdBy: 'user-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      maxRows: 1000,
      folderPath: '/',
    })
  })

  it('uses the delegated principal workspace instead of the query assertion', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/table/tbl_1?workspaceId=workspace-forged'
    )

    const response = await GET(request, routeContext)

    expect(mockReadTable).toHaveBeenCalledOnce()
    expect(response.status).toBe(200)
    expect(mockReadTable.mock.calls[0][0].input).toEqual({
      tableId: 'tbl_1',
      workspaceId: 'workspace-canonical',
    })
  })
})
