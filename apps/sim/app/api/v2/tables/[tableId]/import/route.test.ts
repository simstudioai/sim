/**
 * @vitest-environment node
 *
 * Public v2 synchronous CSV import. The body is multipart, so it never goes
 * through `parseRequest`; the collected text fields are parsed against the
 * contract's form schema instead, and the whole import is delegated to the
 * orchestration function so v1 and v2 cannot drift on what an import does.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockCheckAccess,
  mockReadMultipart,
  mockPerformImport,
  mockGateError,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockCheckAccess: vi.fn(),
  mockReadMultipart: vi.fn(),
  mockPerformImport: vi.fn(),
  mockGateError: vi.fn(),
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceScope: mockResolveWorkspaceScope,
}))

vi.mock('@/app/api/table/utils', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkAccess: mockCheckAccess,
}))

vi.mock('@/lib/core/utils/multipart', () => ({
  readMultipart: mockReadMultipart,
  isMultipartError: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error,
}))

vi.mock('@/lib/table/orchestration', () => ({ performTableCsvImport: mockPerformImport }))
vi.mock('@/lib/table', () => ({ CSV_MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024 }))
vi.mock('@/lib/users/queries', () => ({
  getUserSettings: vi.fn().mockResolvedValue({ timezone: 'UTC' }),
}))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGateError }))

import { POST } from '@/app/api/v2/tables/[tableId]/import/route'

const TABLE = { id: 'table-1', workspaceId: 'ws-1', schema: { columns: [] } }

const RATE_LIMIT_OK = {
  allowed: true,
  userId: 'user-1',
  keyType: 'workspace',
  workspaceId: 'ws-1',
  limit: 100,
  remaining: 99,
  resetAt: new Date('2026-01-01T01:00:00Z'),
}

const IMPORT_DATA = {
  tableId: 'table-1',
  mode: 'append',
  insertedCount: 3,
  mappedColumns: ['Email'],
  skippedHeaders: [],
  unmappedColumns: [],
  sourceFile: 'contacts.csv',
}

function fileStream() {
  return { destroy: vi.fn() }
}

function callPost(options: { contentLength?: string } = {}) {
  const req = new NextRequest('http://localhost:3000/api/v2/tables/table-1/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'multipart/form-data; boundary=x',
      ...(options.contentLength ? { 'content-length': options.contentLength } : {}),
    },
  })
  return POST(req, { params: Promise.resolve({ tableId: 'table-1' }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
  mockResolveWorkspaceScope.mockResolvedValue(null)
  mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
  mockReadMultipart.mockResolvedValue({
    fields: { workspaceId: 'ws-1', mode: 'append' },
    file: { filename: 'contacts.csv', stream: fileStream() },
  })
  mockPerformImport.mockResolvedValue({ success: true, data: IMPORT_DATA })
  mockGateError.mockResolvedValue(null)
})

describe('POST /api/v2/tables/[tableId]/import', () => {
  it('delegates the whole import and returns the summary', async () => {
    const res = await callPost()

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual(IMPORT_DATA)
    expect(mockPerformImport).toHaveBeenCalledWith(
      expect.objectContaining({
        table: TABLE,
        workspaceId: 'ws-1',
        userId: 'user-1',
        fileName: 'contacts.csv',
        fallbackDelimiter: ',',
        mode: 'append',
      })
    )
  })

  it('picks the tab fallback from a .tsv extension', async () => {
    mockReadMultipart.mockResolvedValue({
      fields: { workspaceId: 'ws-1' },
      file: { filename: 'contacts.tsv', stream: fileStream() },
    })

    await callPost()

    expect(mockPerformImport).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackDelimiter: '\t', mode: 'append' })
    )
  })

  it('requires workspaceId ahead of the file part so an unauthorized upload is never read', async () => {
    await callPost()

    expect(mockReadMultipart).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requiredFieldsBeforeFile: ['workspaceId'] })
    )
  })

  it('413s an oversize body rather than importing a silently truncated file', async () => {
    const res = await callPost({ contentLength: String(11 * 1024 * 1024) })

    expect(res.status).toBe(413)
    expect(mockReadMultipart).not.toHaveBeenCalled()
    expect(mockPerformImport).not.toHaveBeenCalled()
  })

  it('400s an unsupported file extension', async () => {
    mockReadMultipart.mockResolvedValue({
      fields: { workspaceId: 'ws-1' },
      file: { filename: 'contacts.xlsx', stream: fileStream() },
    })

    const res = await callPost()

    expect(res.status).toBe(400)
    expect(mockPerformImport).not.toHaveBeenCalled()
  })

  it('400s a form with no workspaceId', async () => {
    mockReadMultipart.mockResolvedValue({
      fields: {},
      file: { filename: 'contacts.csv', stream: fileStream() },
    })

    const res = await callPost()

    expect(res.status).toBe(400)
    expect(mockPerformImport).not.toHaveBeenCalled()
  })

  it('404s a table in another workspace without importing', async () => {
    mockCheckAccess.mockResolvedValue({ ok: true, table: { ...TABLE, workspaceId: 'ws-other' } })

    const res = await callPost()

    expect(res.status).toBe(404)
    expect(mockPerformImport).not.toHaveBeenCalled()
  })

  it('403s a read-only member', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callPost()

    expect(res.status).toBe(403)
    expect(mockPerformImport).not.toHaveBeenCalled()
  })

  it.each([
    ['conflict', 409, 'CONFLICT'],
    ['locked', 423, 'LOCKED'],
    ['validation', 400, 'BAD_REQUEST'],
  ])('maps a %s import failure to %i', async (errorCode, status, code) => {
    mockPerformImport.mockResolvedValue({ success: false, errorCode, error: 'nope' })

    const res = await callPost()

    expect(res.status).toBe(status)
    expect((await res.json()).error.code).toBe(code)
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
    expect(mockPerformImport).not.toHaveBeenCalled()
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
    expect(mockPerformImport).not.toHaveBeenCalled()
  })
})
