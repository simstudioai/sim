import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  V2_TABLE_IMPORT_OPTIONS_MAX_BYTES,
  v2CreateTableImportBodySchema,
  v2CreateTableRowsContract,
  v2TableUploadImportSourceSchema,
  v2UpdateRowsByFilterContract,
  v2UpdateTableRowContract,
  v2UpsertTableRowContract,
} from '@/lib/api/contracts/v2/tables'
import { PRIVATE_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { TABLE_LIMITS } from '@/lib/table/constants'
import { CSV_MAX_FILE_SIZE_BYTES } from '@/lib/table/import'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'

describe('v2 table row contracts', () => {
  it('never expose private secret provenance on the public API', () => {
    for (const contract of [
      v2CreateTableRowsContract,
      v2UpdateRowsByFilterContract,
      v2UpdateTableRowContract,
      v2UpsertTableRowContract,
    ]) {
      expect(
        JSON.stringify(z.toJSONSchema(contract.body, { unrepresentable: 'any' }))
      ).not.toContain(PRIVATE_SECRET_PROVENANCE_FIELD)
    }
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
      v2TableUploadImportSourceSchema.safeParse(uploadSource(CSV_MAX_FILE_SIZE_BYTES)).success
    ).toBe(true)
    expect(
      v2TableUploadImportSourceSchema.safeParse(uploadSource(CSV_MAX_FILE_SIZE_BYTES + 1)).success
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

  it('accepts bounded metadata and rejects collections over the table column limit', () => {
    const mapping = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [`h${index}`, `c${index}`])
    )
    const createColumns = Array.from({ length: 10 }, (_, index) => `c${index}`)

    expect(v2CreateTableImportBodySchema.safeParse(existingTableImport({ mapping })).success).toBe(
      true
    )
    expect(
      v2CreateTableImportBodySchema.safeParse(existingTableImport({ createColumns })).success
    ).toBe(true)

    const mappingOverLimit = Object.fromEntries(
      Array.from({ length: TABLE_LIMITS.MAX_COLUMNS_PER_TABLE + 1 }, (_, index) => [
        String(index),
        'c',
      ])
    )
    const columnsOverLimit = Array.from(
      { length: TABLE_LIMITS.MAX_COLUMNS_PER_TABLE + 1 },
      (_, index) => String(index)
    )
    expect(
      v2CreateTableImportBodySchema.safeParse(existingTableImport({ mapping: mappingOverLimit }))
        .success
    ).toBe(false)
    expect(
      v2CreateTableImportBodySchema.safeParse(
        existingTableImport({ createColumns: columnsOverLimit })
      ).success
    ).toBe(false)
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
