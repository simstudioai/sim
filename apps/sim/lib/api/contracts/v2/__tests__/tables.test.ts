import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { runColumnBodyBaseSchema, TABLE_QUERY_MAX_BODY_BYTES } from '@/lib/api/contracts/tables'
import {
  issueCodes,
  type SchemaLike,
  strictnessTargets,
} from '@/lib/api/contracts/v2/__tests__/schema-introspection'
import { tablesOpenApiDocument } from '@/lib/api/contracts/v2/openapi/tables'
import { V2_SEARCH_MAX_LENGTH } from '@/lib/api/contracts/v2/shared'
import * as tableContracts from '@/lib/api/contracts/v2/tables'
import {
  V2_TABLE_IMPORT_OPTIONS_MAX_BYTES,
  v2AddWorkflowGroupBodySchema,
  v2ApiTableSchema,
  v2CreateTableBodySchema,
  v2CreateTableColumnBodySchema,
  v2CreateTableImportBodySchema,
  v2CreateTableRowsBodySchema,
  v2CsvImportCreateColumnsSchema,
  v2CsvImportMappingSchema,
  v2FindRowsBodySchema,
  v2FindRowsDataSchema,
  v2GetTableImportContract,
  v2QueryRowsBodySchema,
  v2QueryRowsCountBodySchema,
  v2TableImportStatusSchema,
  v2TableUploadImportSourceSchema,
  v2UpdateTableColumnBodySchema,
  v2UpdateWorkflowGroupBodySchema,
} from '@/lib/api/contracts/v2/tables'
import { getValidationErrorMessage } from '@/lib/api/server/validation'
import { MAX_RUN_TARGET_ROW_IDS, TABLE_LIMITS } from '@/lib/table/constants'
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

  /**
   * Same field, same reason, one level down: the group body's `.strict()` binds
   * its own level, so an `outputColumns` entry that kept `workflowGroupId` was
   * stripped, overwritten with the server-minted id, and answered 201.
   */
  it('refuses a workflow group id on a group output column', () => {
    const result = v2AddWorkflowGroupBodySchema.safeParse({
      workspaceId: WORKSPACE_ID,
      group: {
        type: 'enrichment',
        enrichmentId: 'company-domain',
        outputs: [{ blockId: '', path: 'domain', columnName: 'zz_y' }],
      },
      outputColumns: [{ name: 'zz_y', type: 'string', workflowGroupId: 'wfg_does_not_exist' }],
    })

    expect(result.success).toBe(false)
    expect(issueCodes(result.error?.issues ?? [])).toContain('unrecognized_keys')
  })

  it('refuses a workflow group id on an added output column', () => {
    const result = v2UpdateWorkflowGroupBodySchema.safeParse({
      workspaceId: WORKSPACE_ID,
      groupId: 'group-1',
      newOutputColumns: [{ name: 'zz_z', type: 'string', workflowGroupId: 'wfg_does_not_exist' }],
    })

    expect(result.success).toBe(false)
    expect(issueCodes(result.error?.issues ?? [])).toContain('unrecognized_keys')
  })

  it('accepts a group output column that leaves the group id to the server', () => {
    expect(
      v2AddWorkflowGroupBodySchema.safeParse({
        workspaceId: WORKSPACE_ID,
        group: {
          type: 'enrichment',
          enrichmentId: 'company-domain',
          outputs: [{ blockId: '', path: 'domain', columnName: 'zz_y' }],
        },
        outputColumns: [{ name: 'zz_y', type: 'string' }],
      }).success
    ).toBe(true)
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

  it.each([
    ['query', v2QueryRowsBodySchema],
    ['count', v2QueryRowsCountBodySchema],
  ])('normalizes a plain condition on the rows %s body', (_name, schema) => {
    const condition = { field: 'status', op: 'eq', value: 'active' }

    expect(schema.parse({ workspaceId: WORKSPACE_ID, predicate: condition })).toMatchObject({
      predicate: { all: [condition] },
    })
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

/**
 * The published error set has to match what a route can actually emit. The v2
 * JSON builder reads every request body under a byte ceiling BEFORE schema
 * validation, so `413` is reachable on every body-carrying operation — and the
 * two table query reads set a tighter ceiling of their own on top of that. An
 * undocumented status is an unhandled branch in a generated client.
 *
 * One-directional on purpose: several bodyless reads publish `413` for the
 * folder-tree materialization ceiling, so the converse is not asserted.
 */
describe('v2 table operation error sets', () => {
  const operationsById = new Map(
    tablesOpenApiDocument.routes.map((route) => [route.operation.operationId, route.operation])
  )

  it('publishes 413 on every operation that accepts a request body', () => {
    const missing = tablesOpenApiDocument.routes
      .filter((route) => route.contract.body && !route.operation.errors.includes('PayloadTooLarge'))
      .map((route) => route.operation.operationId)

    expect(missing).toEqual([])
  })

  it.each(['queryTableRows', 'countTableRows'])(
    'names the tighter query-body ceiling on %s',
    (operationId) => {
      expect(operationsById.get(operationId)?.errors).toContain('PayloadTooLarge')
      expect(operationsById.get(operationId)?.description).toContain('413')
    }
  )

  it('keeps the body ceiling the two query operations share declared once', () => {
    expect(TABLE_QUERY_MAX_BODY_BYTES).toBe(1024 * 1024)
  })
})

/**
 * The import status enum is the client's exhaustive switch. A state the reads
 * can never return is a dead branch every caller has to write; a phase the read
 * cannot reach at all is worse.
 */
describe('v2 table import lifecycle surface', () => {
  it('publishes only states an import read can return', () => {
    expect(v2TableImportStatusSchema.options).toEqual([
      'uploading',
      'processing',
      'completed',
      'failed',
      'canceled',
      'expired',
    ])
  })

  it('accepts the upload control token on the read, as the cancel already does', () => {
    expect(
      v2GetTableImportContract.headers?.safeParse({ 'upload-token': 'signed-token' })
    ).toMatchObject({ success: true, data: { 'upload-token': 'signed-token' } })
    expect(v2GetTableImportContract.headers?.safeParse({}).success).toBe(true)
  })
})

/**
 * Caller-supplied input that reaches an unindexed scan or a large id list has to
 * carry a declared ceiling; an undeclared one is enforced by the domain as a
 * surprise, or not at all.
 */
describe('v2 table request bounds', () => {
  const findBody = { workspaceId: WORKSPACE_ID, q: 'x' }

  it('caps the Find search term at the shared v2 search length', () => {
    expect(
      v2FindRowsBodySchema.safeParse({ ...findBody, q: 'a'.repeat(V2_SEARCH_MAX_LENGTH) }).success
    ).toBe(true)
    expect(
      v2FindRowsBodySchema.safeParse({ ...findBody, q: 'a'.repeat(V2_SEARCH_MAX_LENGTH + 1) })
        .success
    ).toBe(false)
  })

  it('publishes the Find match cap the truncated flag is derived from', () => {
    expect(
      v2FindRowsDataSchema.safeParse({
        matches: Array.from({ length: TABLE_LIMITS.MAX_FIND_MATCHES + 1 }, () => ({
          ordinal: 0,
          rowId: 'row-1',
          column: 'name',
        })),
        truncated: true,
      }).success
    ).toBe(false)
    expect(JSON.stringify(z.toJSONSchema(v2FindRowsDataSchema))).toContain(
      String(TABLE_LIMITS.MAX_FIND_MATCHES)
    )
  })

  it('declares the run row-id ceiling the domain already enforces', () => {
    const rowIds = z.toJSONSchema(runColumnBodyBaseSchema.shape.rowIds) as {
      anyOf?: Array<{ maxItems?: number; minItems?: number }>
      maxItems?: number
      minItems?: number
    }
    const bounds = rowIds.anyOf?.find((entry) => entry.maxItems !== undefined) ?? rowIds

    expect(bounds.maxItems).toBe(MAX_RUN_TARGET_ROW_IDS)
    expect(bounds.minItems).toBe(1)
  })

  /**
   * The shared group shape defaults `workflowId` to `''`, so the published
   * schema advertised `default: ""` while `refineGroupSource` 400s any manual
   * group that omits it — a documented fallback that always fails.
   */
  it('does not advertise a workflowId default the create refuses to honor', () => {
    const json = z.toJSONSchema(tableContracts.v2AddWorkflowGroupBodySchema, {
      io: 'input',
      unrepresentable: 'any',
    }) as {
      properties?: { group?: { properties?: { workflowId?: { default?: unknown } } } }
    }

    expect(json.properties?.group?.properties?.workflowId?.default).toBeUndefined()
    expect(
      tableContracts.v2AddWorkflowGroupBodySchema.safeParse({
        workspaceId: '6fc7631d-88cd-46f8-9f0a-d4764daef7f8',
        group: {
          type: 'manual',
          outputs: [{ blockId: 'block-1', path: 'result', columnName: 'Result' }],
        },
        outputColumns: [{ name: 'Result', type: 'string' }],
      }).success
    ).toBe(false)
  })

  /**
   * `*` is the wildcard, not `%`. Nothing published said so, so `like: "Hi%"`
   * matched zero rows with a 200 while `like: "Hi*"` matched 1358.
   */
  it('publishes the predicate operator grammar, including the wildcard', () => {
    const published = JSON.stringify(
      z.toJSONSchema(v2QueryRowsBodySchema, { io: 'input', unrepresentable: 'any' })
    )

    expect(published).toContain('`*` is the only wildcard')
    expect(published).toContain('single-select accepts `eq`, `ne`, `in`, `nin`')
    expect(published).toContain('isEmpty')
  })
})
