/**
 * @vitest-environment node
 */
import { hybridAuthMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateTable, mockGetLimits, mockListTables, mockFindActiveFolder } = vi.hoisted(() => ({
  mockCreateTable: vi.fn(),
  mockGetLimits: vi.fn(),
  mockListTables: vi.fn(),
  mockFindActiveFolder: vi.fn(),
}))

vi.mock('@/lib/table', () => ({
  createTable: mockCreateTable,
  getWorkspaceTableLimits: mockGetLimits,
  listTables: mockListTables,
}))
vi.mock('@/lib/folders/queries', () => ({ findActiveFolder: mockFindActiveFolder }))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))
vi.mock('@sim/audit', () => ({
  AuditAction: { TABLE_CREATED: 'table.created' },
  AuditResourceType: { TABLE: 'table' },
  recordAudit: vi.fn(),
}))

import { GET, POST } from '@/app/api/table/route'

const CREATED_TABLE = {
  id: 'tbl_1',
  name: 'people',
  description: null,
  schema: { columns: [{ name: 'name', type: 'string' }] },
  rowCount: 0,
  maxRows: 10_000,
  folderId: null as string | null,
  locks: {
    schemaLocked: false,
    insertLocked: false,
    updateLocked: false,
    deleteLocked: false,
  },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/table', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const createBody = {
  workspaceId: 'workspace-1',
  name: 'people',
  schema: { columns: [{ name: 'name', type: 'string' }] },
}

describe('POST /api/table folder assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetLimits.mockResolvedValue({ maxRowsPerTable: 1_000_000, maxTables: 50 })
    mockCreateTable.mockResolvedValue(CREATED_TABLE)
    mockFindActiveFolder.mockResolvedValue({ id: 'folder-1' })
  })

  it('creates the table at the workspace root when no folder is given', async () => {
    const response = await POST(postRequest(createBody))

    expect(response.status).toBe(200)
    expect(mockFindActiveFolder).not.toHaveBeenCalled()
    expect(mockCreateTable).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: null }),
      expect.any(String)
    )
  })

  it('creates the table inside the requested folder', async () => {
    mockCreateTable.mockResolvedValue({ ...CREATED_TABLE, folderId: 'folder-1' })

    const response = await POST(postRequest({ ...createBody, folderId: 'folder-1' }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(mockCreateTable).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'folder-1' }),
      expect.any(String)
    )
    expect(json.data.table.folderId).toBe('folder-1')
  })

  it('scopes the folder lookup to the workspace and the table folder tree', async () => {
    await POST(postRequest({ ...createBody, folderId: 'folder-1' }))

    expect(mockFindActiveFolder).toHaveBeenCalledWith('folder-1', 'workspace-1', 'table')
  })

  it('rejects a folder id that does not resolve in this workspace or tree', async () => {
    mockFindActiveFolder.mockResolvedValue(null)

    const response = await POST(postRequest({ ...createBody, folderId: 'kb-folder' }))

    expect(response.status).toBe(404)
    expect(mockCreateTable).not.toHaveBeenCalled()
  })

  it('rejects an empty folder id before touching the database', async () => {
    const response = await POST(postRequest({ ...createBody, folderId: '' }))

    expect(response.status).toBe(400)
    expect(mockFindActiveFolder).not.toHaveBeenCalled()
    expect(mockCreateTable).not.toHaveBeenCalled()
  })
})

describe('GET /api/table folder placement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')
  })

  it('emits each table folderId so the list can group rows by folder', async () => {
    mockListTables.mockResolvedValue([
      { ...CREATED_TABLE, id: 'tbl_1', folderId: 'folder-1', workspaceId: 'ws', createdBy: 'u' },
      { ...CREATED_TABLE, id: 'tbl_2', folderId: null, workspaceId: 'ws', createdBy: 'u' },
    ])

    const response = await GET(
      new NextRequest('http://localhost:3000/api/table?workspaceId=workspace-1')
    )
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data.tables.map((t: { folderId: string | null }) => t.folderId)).toEqual([
      'folder-1',
      null,
    ])
  })
})
