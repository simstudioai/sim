/**
 * @vitest-environment node
 *
 * Public v2 streaming export — the one v2 success body that is a file rather
 * than the `{ data }` envelope. The audit is recorded BEFORE the first byte:
 * rows leave incrementally, so a mid-stream failure has still exfiltrated
 * whatever was written.
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckRateLimit,
  mockResolveWorkspaceScope,
  mockCheckAccess,
  mockCreateExportStream,
  mockRecordAudit,
  mockGateError,
} = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockResolveWorkspaceScope: vi.fn(),
  mockCheckAccess: vi.fn(),
  mockCreateExportStream: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockGateError: vi.fn(),
}))

vi.mock('@sim/audit', () => ({
  AuditAction: { TABLE_EXPORTED: 'table.exported' },
  AuditResourceType: { TABLE: 'table' },
  recordAudit: mockRecordAudit,
}))

vi.mock('@/app/api/v1/middleware', () => ({
  checkRateLimit: mockCheckRateLimit,
  resolveWorkspaceScope: mockResolveWorkspaceScope,
}))

vi.mock('@/app/api/table/utils', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  checkAccess: mockCheckAccess,
}))

vi.mock('@/lib/table/export-stream', () => ({
  createTableExportStream: mockCreateExportStream,
  exportContentType: (format: string) =>
    format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json',
  sanitizeExportFilename: (name: string) => name,
}))

vi.mock('@/lib/posthog/server', () => ({ captureServerEvent: vi.fn() }))
vi.mock('@/app/api/v2/lib/gate', () => ({ v2ApiGateError: mockGateError }))

import { GET } from '@/app/api/v2/tables/[tableId]/export/route'

const TABLE = {
  id: 'table-1',
  name: 'customers',
  workspaceId: 'ws-1',
  rowCount: 3,
  schema: { columns: [] },
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

function callGet(query = 'workspaceId=ws-1') {
  const req = new NextRequest(`http://localhost:3000/api/v2/tables/table-1/export?${query}`, {
    method: 'GET',
  })
  return GET(req, { params: Promise.resolve({ tableId: 'table-1' }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCheckRateLimit.mockResolvedValue(RATE_LIMIT_OK)
  mockResolveWorkspaceScope.mockResolvedValue(null)
  mockCheckAccess.mockResolvedValue({ ok: true, table: TABLE })
  mockCreateExportStream.mockReturnValue(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('email\na@b.c\n'))
        controller.close()
      },
    })
  )
  mockGateError.mockResolvedValue(null)
})

describe('GET /api/v2/tables/[tableId]/export', () => {
  it('streams the file with the rate-limit and attachment headers', async () => {
    const res = await callGet()

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="customers.csv"')
    // The envelope carries these on every other v2 endpoint; a stream response
    // has to set them by hand or the whole surface stops being uniform.
    expect(res.headers.get('X-RateLimit-Limit')).toBe('100')
    expect(await res.text()).toBe('email\na@b.c\n')
    expect(mockCreateExportStream).toHaveBeenCalledWith(TABLE, 'csv', expect.any(String))
  })

  it('defaults to csv and honours an explicit json format', async () => {
    const res = await callGet('workspaceId=ws-1&format=json')

    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(mockCreateExportStream).toHaveBeenCalledWith(TABLE, 'json', expect.any(String))
  })

  it('audits before the first byte leaves', async () => {
    await callGet()

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: 'table-1', actorId: 'user-1' })
    )
  })

  it('400s an unsupported format', async () => {
    const res = await callGet('workspaceId=ws-1&format=xml')

    expect(res.status).toBe(400)
    expect(mockCreateExportStream).not.toHaveBeenCalled()
  })

  it('masks a permission failure as 404 so table existence never leaks', async () => {
    mockCheckAccess.mockResolvedValue({ ok: false, status: 403 })

    const res = await callGet()

    expect(res.status).toBe(404)
    expect(mockCreateExportStream).not.toHaveBeenCalled()
    expect(mockRecordAudit).not.toHaveBeenCalled()
  })

  it('404s with the gate off, before any work', async () => {
    mockGateError.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), {
        status: 404,
      })
    )

    const res = await callGet()

    expect(res.status).toBe(404)
    expect(mockCheckAccess).not.toHaveBeenCalled()
    expect(mockCreateExportStream).not.toHaveBeenCalled()
  })

  it('429s a throttled caller', async () => {
    mockCheckRateLimit.mockResolvedValue({
      ...RATE_LIMIT_OK,
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    })

    const res = await callGet()

    expect(res.status).toBe(429)
    expect(mockCreateExportStream).not.toHaveBeenCalled()
  })
})
