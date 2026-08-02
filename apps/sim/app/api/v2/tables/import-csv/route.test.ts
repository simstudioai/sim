/**
 * @vitest-environment node
 *
 * Public v2 create-table-from-CSV. Workspace-scoped rather than table-scoped —
 * there is no table to authorize against yet — and the response is re-read
 * through `toApiTable` so it carries the same table shape as every other v2
 * endpoint rather than the import's partial view.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceAccess,
  mockReadMultipart,
  mockPerformCreate,
  mockGetTableById,
  mockFindActiveFolder,
  mockGateError,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceAccess: vi.fn(),
  mockReadMultipart: vi.fn(),
  mockPerformCreate: vi.fn(),
  mockGetTableById: vi.fn(),
  mockFindActiveFolder: vi.fn(),
  mockGateError: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceAccess: mockResolveWorkspaceAccess,
}))

vi.mock('@/lib/core/utils/multipart', () => ({
  readMultipart: mockReadMultipart,
  isMultipartError: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error,
}))

vi.mock('@/lib/table/orchestration', () => ({ performCreateTableFromCsv: mockPerformCreate }))
vi.mock('@/lib/table', () => ({
  CSV_MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024,
  getTableById: mockGetTableById,
}))
vi.mock('@/lib/folders/queries', () => ({ findActiveFolder: mockFindActiveFolder }))
vi.mock('@/lib/users/queries', () => ({
  getUserSettings: vi.fn().mockResolvedValue({ timezone: 'UTC' }),
}))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGateError }))

import { POST } from '@/app/api/v2/tables/import-csv/route'

const UNLOCKED = {
  schemaLocked: false,
  insertLocked: false,
  updateLocked: false,
  deleteLocked: false,
}
const CREATED_TABLE = {
  id: 'table-1',
  name: 'contacts',
  description: 'Imported from contacts.csv',
  workspaceId: 'ws-1',
  schema: { columns: [] },
  rowCount: 3,
  maxRows: 1000,
  folderId: null,
  locks: UNLOCKED,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
}

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  workspaceId: 'ws-1',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-01-01T01:00:00Z'),
}

function callPost(options: { contentLength?: string } = {}) {
  const req = new NextRequest('http://localhost:3000/api/v2/tables/import-csv', {
    method: 'POST',
    headers: {
      'Content-Type': 'multipart/form-data; boundary=x',
      ...(options.contentLength ? { 'content-length': options.contentLength } : {}),
    },
  })
  return POST(req)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
  mockResolveWorkspaceAccess.mockResolvedValue(null)
  mockReadMultipart.mockResolvedValue({
    fields: { workspaceId: 'ws-1' },
    file: { filename: 'contacts.csv', stream: { destroy: vi.fn() } },
  })
  mockPerformCreate.mockResolvedValue({ success: true, data: { table: { id: 'table-1' } } })
  mockGetTableById.mockResolvedValue(CREATED_TABLE)
  mockFindActiveFolder.mockResolvedValue({ id: 'folder-1' })
  mockGateError.mockResolvedValue(null)
})

describe('POST /api/v2/tables/import-csv', () => {
  it('creates the table and answers 201 with the canonical table shape', async () => {
    const res = await callPost()

    expect(res.status).toBe(201)
    expect((await res.json()).data).toEqual({
      table: {
        id: 'table-1',
        name: 'contacts',
        description: 'Imported from contacts.csv',
        schema: { columns: [] },
        rowCount: 3,
        maxRows: 1000,
        folderId: null,
        locks: UNLOCKED,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    })
    expect(mockPerformCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        userId: 'user-1',
        fileName: 'contacts.csv',
        fallbackDelimiter: ',',
        folderId: null,
      })
    )
  })

  it('checks a supplied folder is a table folder in this workspace', async () => {
    mockReadMultipart.mockResolvedValue({
      fields: { workspaceId: 'ws-1', folderId: 'folder-1' },
      file: { filename: 'contacts.csv', stream: { destroy: vi.fn() } },
    })

    await callPost()

    expect(mockFindActiveFolder).toHaveBeenCalledWith('folder-1', 'ws-1', 'table')
    expect(mockPerformCreate).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'folder-1' })
    )
  })

  it('404s a folder from outside the workspace without importing', async () => {
    mockReadMultipart.mockResolvedValue({
      fields: { workspaceId: 'ws-1', folderId: 'folder-elsewhere' },
      file: { filename: 'contacts.csv', stream: { destroy: vi.fn() } },
    })
    mockFindActiveFolder.mockResolvedValue(null)

    const res = await callPost()

    expect(res.status).toBe(404)
    expect(mockPerformCreate).not.toHaveBeenCalled()
  })

  it('413s an oversize body rather than importing a silently truncated file', async () => {
    const res = await callPost({ contentLength: String(11 * 1024 * 1024) })

    expect(res.status).toBe(413)
    expect(mockReadMultipart).not.toHaveBeenCalled()
    expect(mockPerformCreate).not.toHaveBeenCalled()
  })

  it('403s a caller without workspace write', async () => {
    mockResolveWorkspaceAccess.mockResolvedValue({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Access denied',
    })

    const res = await callPost()

    expect(res.status).toBe(403)
    expect(mockPerformCreate).not.toHaveBeenCalled()
  })

  it('400s a file with no data rows', async () => {
    mockPerformCreate.mockResolvedValue({
      success: false,
      errorCode: 'validation',
      error: 'CSV file has no data rows',
    })

    const res = await callPost()

    expect(res.status).toBe(400)
    expect((await res.json()).error.message).toBe('CSV file has no data rows')
  })

  it('404s with the gate off, before any work', async () => {
    mockGateError.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
      })
    )

    const res = await callPost()

    expect(res.status).toBe(404)
    expect(mockReadMultipart).not.toHaveBeenCalled()
    expect(mockPerformCreate).not.toHaveBeenCalled()
  })

  it('429s a throttled caller', async () => {
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT_OK,
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    })

    const res = await callPost()

    expect(res.status).toBe(429)
    expect(mockPerformCreate).not.toHaveBeenCalled()
  })
})
