import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import * as tableContracts from '@/lib/api/contracts/v2/tables'
import {
  V2_TABLE_IMPORT_OPTIONS_MAX_BYTES,
  v2ApiTableSchema,
  v2CreateTableBodySchema,
  v2CreateTableColumnBodySchema,
  v2CreateTableImportBodySchema,
  v2CsvImportCreateColumnsSchema,
  v2CsvImportMappingSchema,
  v2QueryRowsBodySchema,
  v2TableUploadImportSourceSchema,
  v2UpdateTableColumnBodySchema,
} from '@/lib/api/contracts/v2/tables'
import { TABLE_LIMITS } from '@/lib/table/constants'
import { CSV_DURABLE_MAX_FILE_SIZE_BYTES } from '@/lib/table/import'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'

describe('v2 table column contracts', () => {
  it('accepts required on every public column write so a column round-trips', () => {
    expect(
      v2CreateTableBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        name: 'contacts',
        schema: { columns: [{ name: 'email', type: 'string', required: true }] },
      })
    ).toMatchObject({
      success: true,
      data: { schema: { columns: [{ required: true }] } },
    })
    expect(
      v2CreateTableColumnBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        column: { name: 'email', type: 'string', required: true },
      })
    ).toMatchObject({ success: true, data: { column: { required: true } } })
    expect(
      v2UpdateTableColumnBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        columnName: 'email',
        updates: { required: true },
      })
    ).toMatchObject({ success: true, data: { updates: { required: true } } })
  })

  it('keeps required in table responses for existing stored schemas', () => {
    expect(
      v2ApiTableSchema.safeParse({
        id: 'table-1',
        name: 'contacts',
        description: null,
        ownerEmail: 'owner@example.com',
        schema: { columns: [{ name: 'email', type: 'string', required: false }] },
        rowCount: 0,
        maxRows: 10_000,
        folderPath: '/',
        locks: {
          schemaLocked: false,
          insertLocked: false,
          updateLocked: false,
          deleteLocked: false,
        },
        job: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }).success
    ).toBe(true)
  })
})

interface BodyBearingContract {
  method: string
  path: string
  body: { safeParse: (value: unknown) => z.ZodSafeParseResult<unknown> }
}

function isBodyBearingContract(value: unknown): value is BodyBearingContract {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.method !== 'string' || typeof candidate.path !== 'string') return false
  const body = candidate.body
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { safeParse?: unknown }).safeParse === 'function'
  )
}

/**
 * Zod reports a union's member failures nested under the union issue, so a
 * union-bodied contract needs the whole tree walked before "did any member
 * reject the unknown key" can be answered.
 */
function issueCodes(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.flatMap((issue) => [
    issue.code,
    ...('errors' in issue && Array.isArray(issue.errors)
      ? issue.errors.flatMap((nested: readonly z.core.$ZodIssue[]) => issueCodes(nested))
      : []),
  ])
}

describe('v2 table request bodies', () => {
  const contracts = Object.entries(tableContracts)
    .filter((entry): entry is [string, BodyBearingContract] => isBodyBearingContract(entry[1]))
    .map(([name, contract]) => [`${contract.method} ${contract.path} (${name})`, contract] as const)

  it('covers every table contract that accepts a body', () => {
    expect(contracts.length).toBeGreaterThan(20)
  })

  it.each(contracts)('rejects an unrecognized key on %s', (_label, contract) => {
    const result = contract.body.safeParse({ notAContractField: true })

    expect(result.success).toBe(false)
    expect(issueCodes(result.error?.issues ?? [])).toContain('unrecognized_keys')
  })

  /**
   * The regression this class of bug actually produced: v1 named its row filter
   * `filter`, and a non-strict query body answered that request with 200 and an
   * unfiltered page.
   */
  it('rejects the v1-shaped filter key on the rows query body', () => {
    const result = v2QueryRowsBodySchema.safeParse({
      workspaceId: WORKSPACE_ID,
      filter: { status: { $eq: 'active' } },
    })

    expect(result.success).toBe(false)
    expect(issueCodes(result.error?.issues ?? [])).toContain('unrecognized_keys')
  })
})

function uploadSource(size: number) {
  return {
    type: 'upload' as const,
    name: 'data.csv',
    contentType: 'text/csv',
    size,
  }
}

function existingTableImport(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    source: uploadSource(128),
    target: { type: 'existing' as const, tableId: 'table-1', mode: 'append' as const },
    ...overrides,
  }
}

describe('v2 table import contracts', () => {
  it('accepts the exact CSV byte limit and rejects one byte over it', () => {
    expect(
      v2TableUploadImportSourceSchema.safeParse(uploadSource(CSV_DURABLE_MAX_FILE_SIZE_BYTES))
        .success
    ).toBe(true)
    expect(
      v2TableUploadImportSourceSchema.safeParse(uploadSource(CSV_DURABLE_MAX_FILE_SIZE_BYTES + 1))
        .success
    ).toBe(false)
  })

  it('accepts native JSON mapping and createColumns values', () => {
    const body = existingTableImport({
      mapping: { email: 'email_address', notes: null },
      createColumns: ['phone'],
    })

    expect(v2CreateTableImportBodySchema.parse(body)).toEqual(body)
  })

  it('rejects the legacy FormData JSON-string representation', () => {
    expect(
      v2CreateTableImportBodySchema.safeParse(
        existingTableImport({ mapping: JSON.stringify({ email: 'email_address' }) })
      ).success
    ).toBe(false)
    expect(
      v2CreateTableImportBodySchema.safeParse(
        existingTableImport({ createColumns: JSON.stringify(['phone']) })
      ).success
    ).toBe(false)
  })

  it('caps mapping entries and createColumns items at the table column limit', () => {
    const mapping = Object.fromEntries(
      Array.from({ length: TABLE_LIMITS.MAX_COLUMNS_PER_TABLE }, (_, index) => [
        `header_${index}`,
        `column_${index}`,
      ])
    )
    const createColumns = Array.from(
      { length: TABLE_LIMITS.MAX_COLUMNS_PER_TABLE },
      (_, index) => `header_${index}`
    )

    expect(v2CsvImportMappingSchema.safeParse(mapping).success).toBe(true)
    expect(v2CsvImportCreateColumnsSchema.safeParse(createColumns).success).toBe(true)
    expect(v2CsvImportMappingSchema.safeParse({ ...mapping, overflow: 'overflow' }).success).toBe(
      false
    )
    expect(v2CsvImportCreateColumnsSchema.safeParse([...createColumns, 'overflow']).success).toBe(
      false
    )
  })

  it('bounds CSV header and mapped column names', () => {
    const exact = 'x'.repeat(TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH)
    const over = `${exact}x`

    expect(
      v2CreateTableImportBodySchema.safeParse(
        existingTableImport({ mapping: { [exact]: exact }, createColumns: [exact] })
      ).success
    ).toBe(true)
    expect(
      v2CreateTableImportBodySchema.safeParse(existingTableImport({ mapping: { [over]: exact } }))
        .success
    ).toBe(false)
    expect(
      v2CreateTableImportBodySchema.safeParse(existingTableImport({ mapping: { header: over } }))
        .success
    ).toBe(false)
    expect(
      v2CreateTableImportBodySchema.safeParse(existingTableImport({ createColumns: [over] }))
        .success
    ).toBe(false)
  })

  it('caps aggregate mapping metadata before it is embedded in the signed upload token', () => {
    const mapping = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [
        `header_${index}_${'h'.repeat(30)}`,
        `column_${index}_${'c'.repeat(30)}`,
      ])
    )
    const result = v2CreateTableImportBodySchema.safeParse(existingTableImport({ mapping }))

    expect(new TextEncoder().encode(JSON.stringify({ mapping })).byteLength).toBeGreaterThan(
      V2_TABLE_IMPORT_OPTIONS_MAX_BYTES
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['mapping'],
          message: expect.stringMatching(/signed request token/),
        })
      )
    }
  })
})
