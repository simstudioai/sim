import { describe, expect, it } from 'vitest'
import {
  V2_TABLE_IMPORT_OPTIONS_MAX_BYTES,
  v2ApiTableSchema,
  v2CreateTableBodySchema,
  v2CreateTableColumnBodySchema,
  v2CreateTableImportBodySchema,
  v2CsvImportCreateColumnsSchema,
  v2CsvImportMappingSchema,
  v2TableUploadImportSourceSchema,
  v2UpdateTableColumnBodySchema,
} from '@/lib/api/contracts/v2/tables'
import { TABLE_LIMITS } from '@/lib/table/constants'
import { CSV_DURABLE_MAX_FILE_SIZE_BYTES } from '@/lib/table/import'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'

describe('v2 table column contracts', () => {
  it('rejects required on every public column write', () => {
    expect(
      v2CreateTableBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        name: 'contacts',
        schema: { columns: [{ name: 'email', type: 'string', required: true }] },
      }).success
    ).toBe(false)
    expect(
      v2CreateTableColumnBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        column: { name: 'email', type: 'string', required: true },
      }).success
    ).toBe(false)
    expect(
      v2UpdateTableColumnBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        columnName: 'email',
        updates: { required: true },
      }).success
    ).toBe(false)
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
