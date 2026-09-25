import { describe, expect, it } from 'vitest'
import { issueCodes } from '@/lib/api/contracts/v2/__tests__/schema-introspection'
import * as tableContracts from '@/lib/api/contracts/v2/tables'
import {
  V2_TABLE_IMPORT_OPTIONS_MAX_BYTES,
  v2BulkUpdateRowsBodySchema,
  v2CreateTableBodySchema,
  v2CreateTableImportBodySchema,
  v2QueryRowsBodySchema,
  v2TableUploadImportSourceSchema,
} from '@/lib/api/contracts/v2/tables'
import { getValidationErrorMessage } from '@/lib/api/server/validation'
import { CSV_DURABLE_MAX_FILE_SIZE_BYTES } from '@/lib/table/import'

const WORKSPACE_ID = '6fc7631d-88cd-46f8-9f0a-d4764daef7f8'

describe('v2 table column contracts', () => {
  /**
   * v2 mints workflow group ids server-side and has no way to declare a group
   * on the create body, so any id a caller supplied would name a group that
   * does not exist. `createTable` does not check that, but every later schema
   * mutation does — accepting the field made the created table's columns and
   * groups permanently unaddable, with nothing on the update body able to clear
   * it.
   */
  it('refuses a workflow group id on an initial column', () => {
    const result = v2CreateTableBodySchema.safeParse({
      workspaceId: WORKSPACE_ID,
      name: 'contacts',
      schema: {
        columns: [{ name: 'email', type: 'string', workflowGroupId: 'wfg_does_not_exist' }],
      },
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

describe('v2 opt-in row run state', () => {
  /**
   * `limit: 0` is the unbounded form. Paired with the sidecar it reads the whole
   * table AND its run state before anything can refuse the result, so the pair
   * is refused at the contract — the only place it costs nothing.
   */
  it('refuses the unbounded query form together with the run-state sidecar', () => {
    const result = v2QueryRowsBodySchema.safeParse({
      workspaceId: WORKSPACE_ID,
      limit: 0,
      includeRunState: true,
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]).toMatchObject({
      path: ['limit'],
      message: expect.stringContaining('includeRunState'),
    })
  })

  it('caps the page a run-state read may ask for', () => {
    expect(
      v2QueryRowsBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        limit: tableContracts.V2_MAX_RUN_STATE_ROW_LIMIT + 1,
        includeRunState: true,
      }).success
    ).toBe(false)
    expect(
      v2QueryRowsBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        limit: tableContracts.V2_MAX_RUN_STATE_ROW_LIMIT,
        includeRunState: true,
      }).success
    ).toBe(true)
  })
})

describe('v2 bulk row update contract', () => {
  /**
   * Two patches for one row have no defined precedence, and the primitive
   * applies them in array order — so the caller's second patch silently wins.
   */
  it('refuses a bulk update naming the same row twice', () => {
    const parsed = v2BulkUpdateRowsBodySchema.safeParse({
      workspaceId: WORKSPACE_ID,
      updates: [
        { rowId: 'row-1', data: { name: 'Ada' } },
        { rowId: 'row-1', data: { name: 'Grace' } },
      ],
    })
    expect(parsed.success).toBe(false)
    expect(getValidationErrorMessage(parsed.error!, '')).toContain('Duplicate rowId')
  })
})
