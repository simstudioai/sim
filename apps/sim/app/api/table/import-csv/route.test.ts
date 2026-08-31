/**
 * @vitest-environment node
 */
import {
  hybridAuthMockFns,
  permissionGroupScopeMock,
  permissionGroupScopeMockFns,
  permissionsMock,
  permissionsMockFns,
  resetPermissionGroupScopeMock,
} from '@sim/testing'
import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateTable, mockBatchInsertRows, mockDeleteTable, mockGetLimits } = vi.hoisted(() => ({
  mockCreateTable: vi.fn(),
  mockBatchInsertRows: vi.fn(),
  mockDeleteTable: vi.fn(),
  mockGetLimits: vi.fn(),
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn().mockReturnValue('deadbeefcafef00d'),
  generateShortId: vi.fn().mockReturnValue('short-id'),
}))

// Mock only the DB-backed service/billing functions; the real `./import` helpers
// (createCsvParser, inferSchemaFromCsv, coerceRowsForTable, …) run for real so the
// streaming multipart + CSV pipeline is exercised end-to-end.
vi.mock('@/lib/table/service', () => ({
  createTable: mockCreateTable,
  deleteTable: mockDeleteTable,
}))

vi.mock('@/lib/table/rows/service', () => ({
  batchInsertRows: mockBatchInsertRows,
}))
vi.mock('@/lib/table/billing', () => ({ getWorkspaceTableLimits: mockGetLimits }))
vi.mock('@/app/api/table/utils', async () => {
  const { NextResponse } = await import('next/server')
  const { asOrchestrationError, messageForOrchestrationError, statusForOrchestrationError } =
    await import('@/lib/core/orchestration/types')
  return {
    csvProxyBodyCapResponse: () => null,
    multipartErrorResponse: (error: { code: string; message: string }) =>
      NextResponse.json(
        { error: error.message },
        { status: error.code === 'FILE_TOO_LARGE' ? 413 : 400 }
      ),
    orchestrationOutcomeErrorResponse: (
      outcome: { error?: string; errorCode?: OrchestrationErrorCode; lock?: string },
      fallback: string
    ) =>
      NextResponse.json(
        {
          error: messageForOrchestrationError(outcome, fallback),
          ...(outcome.lock ? { lock: outcome.lock } : {}),
        },
        { status: statusForOrchestrationError(outcome.errorCode) }
      ),
    orchestrationErrorResponse: (error: unknown) => {
      const classified = asOrchestrationError(error)
      return classified
        ? NextResponse.json(
            { error: classified.message },
            { status: statusForOrchestrationError(classified.code) }
          )
        : null
    },
  }
})
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)

import { OrchestrationError, type OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { TableLockedError } from '@/lib/table/mutation-locks'
import { POST } from '@/app/api/table/import-csv/route'

type Part =
  | { name: string; value: string }
  | { name: string; filename: string; value: string; contentType?: string }

const BOUNDARY = '----testboundaryCSV'

function buildBody(parts: Part[]): Buffer {
  const segments: Buffer[] = []
  for (const part of parts) {
    let header = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.name}"`
    if ('filename' in part) {
      header += `; filename="${part.filename}"\r\nContent-Type: ${part.contentType ?? 'text/csv'}`
    }
    header += '\r\n\r\n'
    segments.push(Buffer.from(header, 'utf8'), Buffer.from(part.value, 'utf8'), Buffer.from('\r\n'))
  }
  segments.push(Buffer.from(`--${BOUNDARY}--\r\n`, 'utf8'))
  return Buffer.concat(segments)
}

function makeRequest(parts: Part[], chunkSize?: number): NextRequest {
  const body = buildBody(parts)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (chunkSize) {
        for (let i = 0; i < body.length; i += chunkSize) {
          controller.enqueue(new Uint8Array(body.subarray(i, i + chunkSize)))
        }
      } else {
        controller.enqueue(new Uint8Array(body))
      }
      controller.close()
    },
  })
  return {
    headers: new Headers({ 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }),
    body: stream,
    signal: undefined,
  } as unknown as NextRequest
}

function csvWithRows(count: number): string {
  const lines = ['name,age']
  for (let i = 0; i < count; i++) lines.push(`Person${i},${20 + (i % 50)}`)
  return `${lines.join('\n')}\n`
}

function uploadParts(csv: string): Part[] {
  return [
    { name: 'workspaceId', value: 'workspace-1' },
    { name: 'file', filename: 'data.csv', value: csv },
  ]
}

describe('POST /api/table/import-csv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetPermissionGroupScopeMock()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockGetLimits.mockResolvedValue({ maxRowsPerTable: 1_000_000, maxTables: 50 })
    mockCreateTable.mockImplementation(async (data) => ({
      id: 'tbl_1',
      name: data.name,
      description: data.description ?? null,
      schema: data.schema,
      workspaceId: data.workspaceId,
      maxRows: data.maxRows,
      rowCount: 0,
      createdBy: 'user-1',
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
    mockBatchInsertRows.mockImplementation(async ({ rows }: { rows: unknown[] }) =>
      rows.map((_, i) => ({ id: `row-${i}` }))
    )
    mockDeleteTable.mockResolvedValue(undefined)
  })

  it('streams a CSV upload into a new table and reports the row count', async () => {
    const response = await POST(makeRequest(uploadParts(csvWithRows(250))))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockCreateTable).toHaveBeenCalledTimes(1)
    expect(data.data.table.id).toBe('tbl_1')
    expect(data.data.table.rowCount).toBe(250)
    // 250 rows = a 100-row schema-sample batch + a 150-row remainder batch.
    expect(mockBatchInsertRows).toHaveBeenCalledTimes(2)
  })

  it('parses a body delivered in tiny chunks (regression: missing final boundary)', async () => {
    const response = await POST(makeRequest(uploadParts(csvWithRows(5)), 7))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.data.table.rowCount).toBe(5)
  })

  it('returns 400 for a CSV with no data rows', async () => {
    const response = await POST(makeRequest(uploadParts('name,age\n')))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toMatch(/no data rows/i)
    expect(mockCreateTable).not.toHaveBeenCalled()
  })

  it('returns 400 when the file precedes required fields', async () => {
    const response = await POST(
      makeRequest([
        { name: 'file', filename: 'data.csv', value: csvWithRows(3) },
        { name: 'workspaceId', value: 'workspace-1' },
      ])
    )

    expect(response.status).toBe(400)
    expect(mockCreateTable).not.toHaveBeenCalled()
  })

  it('returns 400 when no file part is present', async () => {
    const response = await POST(makeRequest([{ name: 'workspaceId', value: 'workspace-1' }]))
    expect(response.status).toBe(400)
    expect(mockCreateTable).not.toHaveBeenCalled()
  })

  it('returns 400 with the reason when an insert exceeds the plan row limit', async () => {
    mockBatchInsertRows.mockRejectedValueOnce(
      new OrchestrationError(
        'validation',
        'This table has reached its row limit (1,000 rows) on your current plan.'
      )
    )
    const response = await POST(makeRequest(uploadParts(csvWithRows(250))))
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toMatch(/row limit/)
  })

  it('rolls back the created table when a batch insert fails mid-stream', async () => {
    mockBatchInsertRows
      .mockResolvedValueOnce(Array.from({ length: 100 }, () => ({ id: 'row' })))
      .mockRejectedValueOnce(new Error('insert boom'))

    const response = await POST(makeRequest(uploadParts(csvWithRows(250))))

    expect(response.status).toBe(500)
    expect(mockDeleteTable).toHaveBeenCalledWith('tbl_1', expect.any(String))
  })

  it('names the lock that rejected the import on a 423', async () => {
    // The lock kind is the only thing that tells a client which lock to clear; rendering the
    // outcome by hand is how the field gets dropped from one route and not its sibling.
    mockBatchInsertRows.mockRejectedValueOnce(new TableLockedError('insert'))

    const response = await POST(makeRequest(uploadParts(csvWithRows(250))))
    const data = await response.json()

    expect(response.status).toBe(423)
    expect(data.lock).toBe('insert')
    expect(data.error).toMatch(/lock/i)
  })

  it('returns 401 when unauthenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({ success: false })
    const response = await POST(makeRequest(uploadParts(csvWithRows(3))))
    expect(response.status).toBe(401)
  })

  it('returns 403 without write permission', async () => {
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('read')
    const response = await POST(makeRequest(uploadParts(csvWithRows(3))))
    expect(response.status).toBe(403)
  })

  /**
   * A CSV import creates a table, so `tables.create` governs it. A group that
   * only sets `disableTableCreation` leaves Tables visible and usable, which is
   * exactly the configuration a `tables.use` gate would let through.
   */
  it('refuses the import when the group disables table creation', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      disableTableCreation: true,
    })

    const response = await POST(makeRequest(uploadParts(csvWithRows(3))))

    expect(response.status).toBe(403)
    expect((await response.json()).details).toEqual({
      code: 'PERMISSION_GROUP_CAPABILITY_BLOCKED',
    })
    expect(mockCreateTable).not.toHaveBeenCalled()
  })

  it('refuses the import when the group hides Tables entirely', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideTablesTab: true,
    })

    const response = await POST(makeRequest(uploadParts(csvWithRows(3))))

    expect(response.status).toBe(403)
    expect(mockCreateTable).not.toHaveBeenCalled()
  })

  it('lets the import through when the group withholds something else', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideKnowledgeBaseTab: true,
    })

    const response = await POST(makeRequest(uploadParts(csvWithRows(3))))

    expect(response.status).toBe(200)
    expect(mockCreateTable).toHaveBeenCalledTimes(1)
  })
})
