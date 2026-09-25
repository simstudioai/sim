import {
  createTableDefinition,
  hybridAuthMockFns,
  type TableDefinitionFactoryOptions,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableDefinition } from '@/lib/table'

const {
  mockCheckAccess,
  mockImportAppendRows,
  mockImportReplaceRows,
  mockDispatchAfterBatchInsert,
  mockMarkTableImporting,
  mockReleaseImportClaim,
  mockGetMaxRowsPerTable,
} = vi.hoisted(() => ({
  mockCheckAccess: vi.fn(),
  mockImportAppendRows: vi.fn(),
  mockImportReplaceRows: vi.fn(),
  mockDispatchAfterBatchInsert: vi.fn(),
  mockMarkTableImporting: vi.fn(),
  mockReleaseImportClaim: vi.fn(),
  mockGetMaxRowsPerTable: vi.fn(),
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn().mockReturnValue('deadbeefcafef00d'),
  generateShortId: vi.fn().mockReturnValue('short-id'),
}))

vi.mock('@/app/api/table/utils', async () => {
  const { NextResponse } = await import('next/server')
  const { TableLockedError } = await import('@/lib/table/mutation-locks')
  return {
    checkAccess: mockCheckAccess,
    /** Mirrors the real helper: only a `user` principal names a governed subject. */
    capabilityGovernedUserId: (principal: { kind: string; userId?: string }) =>
      principal.kind === 'user' ? (principal.userId ?? null) : null,
    accessError: (result: { status: number }) => {
      const message = result.status === 404 ? 'Table not found' : 'Access denied'
      return NextResponse.json({ error: message }, { status: result.status })
    },
    csvProxyBodyCapResponse: () => null,
    tableLockErrorResponse: (error: unknown) =>
      error instanceof TableLockedError
        ? NextResponse.json({ error: error.message, lock: error.lock }, { status: 423 })
        : null,
    multipartErrorResponse: (error: { code: string; message: string }) =>
      NextResponse.json(
        { error: error.message },
        { status: error.code === 'FILE_TOO_LARGE' ? 413 : 400 }
      ),
  }
})

/**
 * The route imports `importAppendRows` / `importReplaceRows` from
 * `@/lib/table/import-data`. These functions own the import transaction (column
 * adds + row writes); mocking that module replaces them without touching the
 * other real helpers (`coerceRowsForTable`, `createCsvParser`, etc.) exported
 * through the barrel.
 */
vi.mock('@/lib/table/import-data', () => ({
  importAppendRows: mockImportAppendRows,
  importReplaceRows: mockImportReplaceRows,
}))

vi.mock('@/lib/table/jobs/service', () => ({
  markTableJobRunning: mockMarkTableImporting,
  releaseJobClaim: mockReleaseImportClaim,
}))

vi.mock('@/lib/table/rows/service', () => ({
  dispatchAfterBatchInsert: mockDispatchAfterBatchInsert,
}))

/** The append pre-check reads the workspace's current plan row limit, not the frozen `table.maxRows`. */
vi.mock('@/lib/table/billing', () => ({
  getMaxRowsPerTable: mockGetMaxRowsPerTable,
  wouldExceedRowLimit: (limit: number, current: number, added: number) =>
    limit >= 0 && current + added > limit,
}))

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { TableLockedError } from '@/lib/table/mutation-locks'
import { POST } from '@/app/api/table/[tableId]/import/route'

function createCsvFile(contents: string, name = 'data.csv', type = 'text/csv'): File {
  return new File([contents], name, { type })
}

function createFormData(
  file: File,
  options?: {
    workspaceId?: string | null
    mode?: string | null
    mapping?: unknown
    createColumns?: unknown
  }
): FormData {
  // Text fields must precede the file part for the streaming parser.
  const form = new FormData()
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
  if (options?.createColumns !== undefined) {
    form.append(
      'createColumns',
      typeof options.createColumns === 'string'
        ? options.createColumns
        : JSON.stringify(options.createColumns)
    )
  }
  form.append('file', file)
  return form
}

const TABLE_FIXTURE: TableDefinitionFactoryOptions = {
  columns: [
    { name: 'name', type: 'string', required: true },
    { name: 'age', type: 'number' },
  ],
  maxRows: 100,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

/** Additions array the route passed to importAppendRows (2nd positional arg). */
function appendAdditions(): { name: string; type: string }[] {
  return mockImportAppendRows.mock.calls[0][1] as { name: string; type: string }[]
}

async function callPost(form: FormData, { tableId }: { tableId: string } = { tableId: 'tbl_1' }) {
  // Building the request from a FormData body gives a real multipart stream and
  // boundary, exercising the streaming `readMultipart` parser end-to-end.
  const req = new NextRequest(`http://localhost:3000/api/table/${tableId}/import`, {
    method: 'POST',
    body: form,
  })
  return POST(req, { params: Promise.resolve({ tableId }) })
}

describe('POST /api/table/[tableId]/import', () => {
  beforeEach(() => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      authType: 'session',
    })
    mockCheckAccess.mockResolvedValue({ ok: true, table: createTableDefinition(TABLE_FIXTURE) })
    mockImportAppendRows.mockImplementation(
      async (table: TableDefinition, _additions: unknown, rows: unknown[]) => ({
        inserted: rows.map((_, i) => ({ id: `row_${i}` })),
        table,
      })
    )
    mockImportReplaceRows.mockResolvedValue({ deletedCount: 0, insertedCount: 0 })
    mockMarkTableImporting.mockResolvedValue(true)
    mockReleaseImportClaim.mockResolvedValue(undefined)
    mockGetMaxRowsPerTable.mockResolvedValue(1_000_000)
  })

  it('returns 409 when a background import already holds the table (claim lost)', async () => {
    mockMarkTableImporting.mockResolvedValueOnce(false)
    const response = await callPost(createFormData(createCsvFile('name,age\nAlice,30')))
    expect(response.status).toBe(409)
    expect(mockImportAppendRows).not.toHaveBeenCalled()
    expect(mockImportReplaceRows).not.toHaveBeenCalled()
    expect(mockReleaseImportClaim).not.toHaveBeenCalled()
  })

  it('returns 403 when the user lacks workspace write access', async () => {
    mockCheckAccess.mockResolvedValueOnce({ ok: false, status: 403 })
    const response = await callPost(createFormData(createCsvFile('name,age\nAlice,30')))
    expect(response.status).toBe(403)
  })

  it('returns 400 when the file part precedes the required fields', async () => {
    // Build a raw multipart body with the file BEFORE workspaceId.
    const boundary = '----orderboundary'
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="data.csv"\r\nContent-Type: text/csv\r\n\r\nname,age\nAlice,30\r\n`
      ),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="workspaceId"\r\n\r\n`),
      Buffer.from('workspace-1\r\n'),
      Buffer.from(`--${boundary}--\r\n`),
    ])
    const req = {
      headers: new Headers({ 'content-type': `multipart/form-data; boundary=${boundary}` }),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(body))
          controller.close()
        },
      }),
      signal: undefined,
    } as unknown as NextRequest

    const response = await POST(req, { params: Promise.resolve({ tableId: 'tbl_1' }) })
    expect(response.status).toBe(400)
    expect(mockImportAppendRows).not.toHaveBeenCalled()
    expect(mockImportReplaceRows).not.toHaveBeenCalled()
  })

  /**
   * The appended rows auto-fire the table's workflow columns, and those cells
   * gate their tools on the governed subject. Leaving it null ran the importing
   * member's cells with no per-tool gate at all.
   */
  it('dispatches the auto-fired cells under the person it just gated', async () => {
    await callPost(createFormData(createCsvFile('name,age\nAlice,30'), { mode: 'append' }))

    expect(mockDispatchAfterBatchInsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'user-1',
      'user-1'
    )
  })

  /**
   * `checkSessionOrInternalAuth` also accepts an internal JWT, whose user id is
   * the run's actor — potentially the workspace billing owner. Dispatching the
   * auto-fired cells under it would run them with that bystander's permission
   * group; an executor call must dispatch under nobody.
   */
  it('dispatches an internal-JWT import under nobody, not the run actor', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'billing-owner',
      authType: 'internal_jwt',
    })

    await callPost(createFormData(createCsvFile('name,age\nAlice,30'), { mode: 'append' }))

    expect(mockDispatchAfterBatchInsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'billing-owner',
      null
    )
  })

  it('accepts chunked multipart imports without a content-length header', async () => {
    const form = createFormData(createCsvFile('name,age\nAlice,30'), { mode: 'append' })
    const req = new NextRequest('http://localhost:3000/api/table/tbl_1/import', {
      method: 'POST',
      body: form,
    })

    expect(req.headers.get('content-length')).toBeNull()

    const response = await POST(req, { params: Promise.resolve({ tableId: 'tbl_1' }) })

    expect(response.status).toBe(200)
    expect(mockImportAppendRows).toHaveBeenCalledTimes(1)
  })

  it('rejects append when it would exceed the current plan row limit', async () => {
    mockCheckAccess.mockResolvedValueOnce({
      ok: true,
      table: createTableDefinition({ ...TABLE_FIXTURE, rowCount: 99 }),
    })
    mockGetMaxRowsPerTable.mockResolvedValueOnce(100)
    const response = await callPost(
      createFormData(createCsvFile('name,age\nAlice,30\nBob,40'), { mode: 'append' })
    )
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toMatch(/exceed table row limit/)
    expect(mockImportAppendRows).not.toHaveBeenCalled()
  })

  it('maps a lock violation from importAppendRows to 423, not 500', async () => {
    // The append branch returns instead of rethrowing, so it must map the lock
    // error itself — the outer catch's mapper never sees it.
    mockImportAppendRows.mockRejectedValueOnce(new TableLockedError('insert'))
    const response = await callPost(
      createFormData(createCsvFile('name,age\nAlice,30'), { mode: 'append' })
    )
    expect(response.status).toBe(423)
    const data = await response.json()
    expect(data.lock).toBe('insert')
    // A `details` array would make the client treat it as a validation error
    // and swallow the toast.
    expect(data.details).toBeUndefined()
  })

  describe('createColumns', () => {
    it('infers column type from CSV row values', async () => {
      const response = await callPost(
        createFormData(createCsvFile('name,score\nAlice,42\nBob,17'), {
          mode: 'append',
          createColumns: ['score'],
        })
      )
      expect(response.status).toBe(200)
      expect(appendAdditions()).toEqual([
        expect.objectContaining({ name: 'score', type: 'number' }),
      ])
    })

    it('dedupes when sanitized name collides with an existing column', async () => {
      mockCheckAccess.mockResolvedValueOnce({
        ok: true,
        table: createTableDefinition({
          ...TABLE_FIXTURE,
          columns: [
            { name: 'name', type: 'string', required: true },
            { name: 'age', type: 'number' },
            { name: 'email', type: 'string' },
          ],
        }),
      })
      const response = await callPost(
        createFormData(createCsvFile('name,age,Email\nAlice,30,a@x.io'), {
          mode: 'append',
          createColumns: ['Email'],
        })
      )
      expect(response.status).toBe(200)
      expect(appendAdditions()).toEqual([
        expect.objectContaining({ name: 'Email_2', type: 'string' }),
      ])
    })

    it('surfaces row insert failures without success when schema was mutated', async () => {
      mockImportAppendRows.mockRejectedValueOnce(
        new OrchestrationError('validation', 'must be unique')
      )
      const response = await callPost(
        createFormData(createCsvFile('name,age,email\nAlice,30,a@x.io'), {
          mode: 'append',
          createColumns: ['email'],
        })
      )
      // Route forwarded the column addition into the (now atomic) import op.
      expect(appendAdditions()).toEqual([
        expect.objectContaining({ name: 'email', type: 'string' }),
      ])
      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.success).toBeUndefined()
      expect(data.error).toMatch(/must be unique/)
    })
  })
})
