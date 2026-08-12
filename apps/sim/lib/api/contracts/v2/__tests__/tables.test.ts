import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import * as tableContracts from '@/lib/api/contracts/v2/tables'
import {
  V2_TABLE_IMPORT_OPTIONS_MAX_BYTES,
  v2ApiTableSchema,
  v2CreateTableBodySchema,
  v2CreateTableColumnBodySchema,
  v2CreateTableImportBodySchema,
  v2CreateTableRowsBodySchema,
  v2CsvImportCreateColumnsSchema,
  v2CsvImportMappingSchema,
  v2QueryRowsBodySchema,
  v2TableUploadImportSourceSchema,
  v2UpdateTableColumnBodySchema,
} from '@/lib/api/contracts/v2/tables'
import { getValidationErrorMessage } from '@/lib/api/server/validation'
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

interface SchemaLike {
  safeParse: (value: unknown) => z.ZodSafeParseResult<unknown>
  def?: { type?: unknown; options?: unknown }
}

interface BodyBearingContract {
  method: string
  path: string
  body: SchemaLike
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

/**
 * Flattens a union body into the schemas that actually enforce strictness.
 *
 * Asserting against the union itself is not enough: one strict member satisfies
 * "some issue in the tree is `unrecognized_keys`", so a sibling member that
 * stopped being strict would still sweep green. Each member is swept on its own
 * so exactly the regressed member fails.
 */
function strictnessTargets(schema: SchemaLike): SchemaLike[] {
  const options = schema.def?.type === 'union' ? schema.def.options : undefined
  if (!Array.isArray(options)) return [schema]
  return options.flatMap((option) => strictnessTargets(option as SchemaLike))
}

describe('v2 table request bodies', () => {
  const contracts = Object.entries(tableContracts)
    .filter((entry): entry is [string, BodyBearingContract] => isBodyBearingContract(entry[1]))
    .map(([name, contract]) => [`${contract.method} ${contract.path} (${name})`, contract] as const)

  const bodySchemas = contracts.flatMap(([label, contract]) => {
    const targets = strictnessTargets(contract.body)
    return targets.length === 1
      ? [[label, targets[0]] as const]
      : targets.map((target, index) => [`${label} union member ${index}`, target] as const)
  })

  it('covers every table contract that accepts a body', () => {
    expect(contracts.length).toBeGreaterThan(20)
  })

  /**
   * Guards the sweep itself: if the rows body stopped expanding into its two
   * members, every case below would collapse back to the vacuous union
   * assertion without any test turning red.
   */
  it('sweeps each member of the union-bodied rows contract separately', () => {
    expect(strictnessTargets(v2CreateTableRowsBodySchema)).toHaveLength(2)
    expect(bodySchemas.length).toBeGreaterThan(contracts.length)
  })

  it.each(bodySchemas)('rejects an unrecognized key on %s', (_label, schema) => {
    const result = schema.safeParse({ notAContractField: true })

    expect(result.success).toBe(false)
    expect(issueCodes(result.error?.issues ?? [])).toContain('unrecognized_keys')
  })

  /**
   * A union's first issue is `invalid_union`, and its default message —
   * `Invalid input` — is what the 400 body surfaces. The v2 conventions name
   * that exact string as failing the "errors must be actionable" rule.
   */
  it('names both accepted shapes when the rows body matches neither', () => {
    const result = v2CreateTableRowsBodySchema.safeParse({
      workspaceId: WORKSPACE_ID,
      data: { name: 'ada' },
      bogus: 1,
    })

    expect(result.success).toBe(false)
    expect(getValidationErrorMessage(result.error as z.ZodError)).toBe(
      'Row insert body must be either { rows: [...] } for a batch insert or { data: {...} } for a single row'
    )
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
