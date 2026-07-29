/**
 * @vitest-environment node
 */
import { hybridAuthMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCreateTable,
  mockGetLimits,
  mockListTables,
  mockRunTableImport,
  mockRunDetached,
  mockFindActiveFolder,
  MockTableConflictError,
} = vi.hoisted(() => ({
  mockCreateTable: vi.fn(),
  mockGetLimits: vi.fn(),
  mockListTables: vi.fn(),
  mockRunTableImport: vi.fn(),
  mockRunDetached: vi.fn(),
  mockFindActiveFolder: vi.fn(),
  MockTableConflictError: class extends Error {
    readonly code = 'TABLE_EXISTS' as const
  },
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn().mockReturnValue('import-id-123'),
  generateShortId: vi.fn().mockReturnValue('short-id'),
}))

vi.mock('@/lib/table', () => ({
  createTable: mockCreateTable,
  getWorkspaceTableLimits: mockGetLimits,
  listTables: mockListTables,
  sanitizeName: (name: string) => name.replace(/[^a-zA-Z0-9_]/g, '_'),
  TABLE_LIMITS: { MAX_TABLE_NAME_LENGTH: 128 },
  TableConflictError: MockTableConflictError,
}))
vi.mock('@/lib/table/import-runner', () => ({ runTableImport: mockRunTableImport }))
vi.mock('@/lib/folders/queries', () => ({ findActiveFolder: mockFindActiveFolder }))
vi.mock('@/lib/core/utils/background', () => ({
  runDetached: mockRunDetached.mockImplementation(
    (_label: string, work: () => Promise<unknown>) => {
      void work()
    }
  ),
}))
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

import { POST } from '@/app/api/table/import-async/route'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/table/import-async', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = {
  workspaceId: 'workspace-1',
  fileKey: 'workspace/workspace-1/123-data.csv',
  fileName: 'data.csv',
}

describe('POST /api/table/import-async', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetLimits.mockResolvedValue({ maxRowsPerTable: 1_000_000, maxTables: 50 })
    mockListTables.mockResolvedValue([])
    mockCreateTable.mockResolvedValue({ id: 'tbl_async', name: 'data' })
    mockRunTableImport.mockResolvedValue(undefined)
    mockFindActiveFolder.mockResolvedValue({ id: 'folder-1' })
  })

  it('imports into the workspace root when no folder is given', async () => {
    await POST(makeRequest(validBody))

    expect(mockFindActiveFolder).not.toHaveBeenCalled()
    expect(mockCreateTable).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: undefined }),
      expect.any(String)
    )
  })

  it('creates the imported table inside the requested folder', async () => {
    await POST(makeRequest({ ...validBody, folderId: 'folder-1' }))

    expect(mockFindActiveFolder).toHaveBeenCalledWith('folder-1', 'workspace-1', 'table')
    expect(mockCreateTable).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'folder-1' }),
      expect.any(String)
    )
  })

  it('rejects a folder from another workspace or resource tree', async () => {
    mockFindActiveFolder.mockResolvedValue(null)

    const response = await POST(makeRequest({ ...validBody, folderId: 'kb-folder' }))

    expect(response.status).toBe(404)
    expect(mockCreateTable).not.toHaveBeenCalled()
  })

  it('creates an importing table and kicks off the background import', async () => {
    const response = await POST(makeRequest(validBody))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data).toEqual({ tableId: 'tbl_async', importId: 'import-id-123' })
    expect(mockCreateTable).toHaveBeenCalledWith(
      expect.objectContaining({ jobStatus: 'running', jobType: 'import', jobId: 'import-id-123' }),
      expect.any(String)
    )
    expect(mockRunTableImport).toHaveBeenCalledWith(
      expect.objectContaining({ tableId: 'tbl_async', mode: 'create', delimiter: ',' })
    )
  })

  it('uses a tab delimiter for .tsv files', async () => {
    await POST(makeRequest({ ...validBody, fileName: 'data.tsv' }))
    expect(mockRunTableImport).toHaveBeenCalledWith(expect.objectContaining({ delimiter: '\t' }))
  })

  it('returns 400 for unsupported extensions', async () => {
    const response = await POST(makeRequest({ ...validBody, fileName: 'data.json' }))
    expect(response.status).toBe(400)
    expect(mockCreateTable).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({ success: false })
    const response = await POST(makeRequest(validBody))
    expect(response.status).toBe(401)
  })

  it('returns 403 without write permission', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')
    const response = await POST(makeRequest(validBody))
    expect(response.status).toBe(403)
    expect(mockCreateTable).not.toHaveBeenCalled()
  })

  it('returns 400 when the body is missing required fields', async () => {
    const response = await POST(makeRequest({ workspaceId: 'workspace-1' }))
    expect(response.status).toBe(400)
  })
})
