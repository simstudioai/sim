/**
 * @vitest-environment node
 */
import { hybridAuthMock, hybridAuthMockFns, requestUtilsMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const { mockCheckAccess, mockBatchInsertRows, mockReplaceTableRows } = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockBatchInsertRows: vi.fn(),
  mockReplaceTableRows: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => hybridAuthMock)

vi.mock('@/lib/core/utils/request', () => requestUtilsMock)

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn().mockReturnValue('deadbeefcafef00d'),
  generateShortId: vi.fn().mockReturnValue('short-id'),
}))

vi.mock('@/app/api/table/utils', async () => {
  const { NextResponse } = await import('next/server')
  return {
    checkAccess: mockCheckAccess,
    accessError: (result: { status: number }) => {
      const message = result.status === 404 ? 'Table not found' : 'Access denied'
      return NextResponse.json({ error: message }, { status: result.status })
    },
  }
})

/**
 * The route imports `batchInsertRows` and `replaceTableRows` from the barrel,
 * which forwards them from `./service`. Mocking the service module replaces
 * both without having to touch the other real helpers (`parseCsvBuffer`,
 * `coerceRowsForTable`, etc.) exported through the barrel.
 */
vi.mock('@/lib/table/service', () => ({
  batchInsertRows: mockBatchInsertRows,
  replaceTableRows: mockReplaceTableRows,
}))

import { POST } from '@/app/api/table/[tableId]/import-csv/route'

function createCsvFile(contents: string, name = 'data.csv', type = 'text/csv'): File {
  return new File([contents], name, { type })
}

function createFormData(
  file: File,
  options?: {
    workspaceId?: string | null
    mode?: string | null
    mapping?: unknown
  }
): FormData {
  const form = new FormData()
  form.append('file', file)
  if (options?.workspaceId !== null) {
    form.append('workspaceId', options?.workspaceId ?? 'workspace-1')
  }
  if (options?.mode !== null) {
    form.append('mode', options?.mode ?? 'append')
  }
  if (options?.mapping !== undefined) {
    form.append(
      'mapping',
      typeof options.mapping === 'string' ? options.mapping : JSON.stringify(options.mapping)
    )
  }
  return form
}

function buildTable(overrides: Partial<TableDefinition> = {}): TableDefinition {
  return {
    id: 'tbl_1',
    name: 'People',
    description: null,
    schema: {
      columns: [
        { name: 'name', type: 'string', required: true },
        { name: 'age', type: 'number' },
      ],
    },
    metadata: null,
    rowCount: 0,
    maxRows: 100,
    workspaceId: 'workspace-1',
    createdBy: 'user-1',
    archivedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

async function callPost(form: FormData, { tableId }: { tableId: string } = { tableId: 'tbl_1' }) {
  const req = new NextRequest(`http://localhost:3000/api/table/${tableId}/import-csv`, {
    method: 'POST',
    body: form,
  })
  return POST(req, { params: Promise.resolve({ tableId }) })
}

describe('POST /api/table/[tableId]/import-csv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table: buildTable() })
    mockBatchInsertRows.mockImplementation(async (data: { rows: unknown[] }) =>
      data.rows.map((_, i) => ({ id: `row_${i}` }))
    )
    mockReplaceTableRows.mockResolvedValue({ deletedCount: 0, insertedCount: 0 })
  })

  it('returns 401 when the user is not authenticated', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: false,
      error: 'Authentication required',
    })
    const response = await callPost(createFormData(createCsvFile('name,age\nAlice,30')))
    expect(response.status).toBe(401)
  })

  it('returns 400 when the mode is invalid', async () => {
    const response = await callPost(
      createFormData(createCsvFile('name,age\nAlice,30'), { mode: 'bogus' })
    )
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toMatch(/Invalid mode/)
  })

  it('returns 403 when the user lacks workspace write access', async () => {
    mockCheckAccess.mockResolvedValueOnce({ ok: false, status: 403 })
    const response = await callPost(createFormData(createCsvFile('name,age\nAlice,30')))
    expect(response.status).toBe(403)
  })

  it('returns 400 when the target table is archived', async () => {
    mockCheckAccess.mockResolvedValueOnce({
      ok: true,
      table: buildTable({ archivedAt: new Date('2024-01-02') }),
    })
    const response = await callPost(createFormData(createCsvFile('name,age\nAlice,30')))
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toMatch(/archived/i)
  })

  it('returns 400 when the CSV is missing a required column', async () => {
    const response = await callPost(createFormData(createCsvFile('age\n30')))
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toMatch(/missing required columns/i)
    expect(data.details?.missingRequired).toEqual(['name'])
    expect(mockBatchInsertRows).not.toHaveBeenCalled()
  })

  it('appends rows via batchInsertRows', async () => {
    const response = await callPost(
      createFormData(createCsvFile('name,age\nAlice,30\nBob,40'), { mode: 'append' })
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.data.mode).toBe('append')
    expect(data.data.insertedCount).toBe(2)
    expect(mockBatchInsertRows).toHaveBeenCalledTimes(1)
    const callArgs = mockBatchInsertRows.mock.calls[0][0] as { rows: unknown[] }
    expect(callArgs.rows).toEqual([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 40 },
    ])
    expect(mockReplaceTableRows).not.toHaveBeenCalled()
  })

  it('rejects append when it would exceed maxRows', async () => {
    mockCheckAccess.mockResolvedValueOnce({
      ok: true,
      table: buildTable({ rowCount: 99, maxRows: 100 }),
    })
    const response = await callPost(
      createFormData(createCsvFile('name,age\nAlice,30\nBob,40'), { mode: 'append' })
    )
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toMatch(/exceed table row limit/)
    expect(mockBatchInsertRows).not.toHaveBeenCalled()
  })

  it('replaces rows via replaceTableRows', async () => {
    mockReplaceTableRows.mockResolvedValueOnce({ deletedCount: 5, insertedCount: 2 })
    const response = await callPost(
      createFormData(createCsvFile('name,age\nAlice,30\nBob,40'), { mode: 'replace' })
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.data.mode).toBe('replace')
    expect(data.data.deletedCount).toBe(5)
    expect(data.data.insertedCount).toBe(2)
    expect(mockReplaceTableRows).toHaveBeenCalledTimes(1)
    expect(mockBatchInsertRows).not.toHaveBeenCalled()
  })

  it('uses an explicit mapping when provided', async () => {
    const response = await callPost(
      createFormData(createCsvFile('First Name,Years\nAlice,30\nBob,40', 'people.csv'), {
        mode: 'append',
        mapping: { 'First Name': 'name', Years: 'age' },
      })
    )
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.data.mappedColumns).toEqual(['First Name', 'Years'])
    const callArgs = mockBatchInsertRows.mock.calls[0][0] as { rows: unknown[] }
    expect(callArgs.rows).toEqual([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 40 },
    ])
  })

  it('returns 400 when the mapping targets a non-existent column', async () => {
    const response = await callPost(
      createFormData(createCsvFile('a\nAlice'), {
        mode: 'append',
        mapping: { a: 'nonexistent' },
      })
    )
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toMatch(/do not exist on the table/)
  })

  it('returns 400 when a mapping value is not a string or null', async () => {
    const response = await callPost(
      createFormData(createCsvFile('name,age\nAlice,30'), {
        mode: 'append',
        mapping: { name: 42 },
      })
    )
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toMatch(/Mapping values must be/)
  })

  it('surfaces unique violations from batchInsertRows as 400', async () => {
    mockBatchInsertRows.mockRejectedValueOnce(
      new Error('Row 1: Column "name" must be unique. Value "Alice" already exists in row row_xxx')
    )
    const response = await callPost(
      createFormData(createCsvFile('name,age\nAlice,30'), { mode: 'append' })
    )
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toMatch(/must be unique/)
    expect(data.data?.insertedCount).toBe(0)
  })

  it('accepts TSV files', async () => {
    const response = await callPost(
      createFormData(
        createCsvFile('name\tage\nAlice\t30', 'data.tsv', 'text/tab-separated-values'),
        { mode: 'append' }
      )
    )
    expect(response.status).toBe(200)
    expect(mockBatchInsertRows).toHaveBeenCalledTimes(1)
  })

  it('returns 400 for unsupported file extensions', async () => {
    const response = await callPost(
      createFormData(createCsvFile('name,age', 'data.json', 'application/json'))
    )
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toMatch(/CSV and TSV/)
  })
})
