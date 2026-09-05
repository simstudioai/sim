import { isRecordLike } from '@sim/utils/object'
import { z } from 'zod'
import {
  booleanQueryFlagSchema,
  folderIdSchema,
  MAX_ID_LENGTH,
  privateSecretProvenanceBundleSchema,
  requiredFieldSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import { ianaTimezoneSchema } from '@/lib/api/contracts/user'
import { PRIVATE_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import type {
  CsvHeaderMapping,
  EnrichmentRunDetail,
  Filter,
  Predicate,
  PredicateNode,
  RowData,
  Sort,
  SortSpec,
  TableDefinition,
  TableLocks,
  TableMetadata,
  TablePredicate,
  TableRow,
  TableRowsCursor,
  TableViewConfig,
} from '@/lib/table'
import {
  COLUMN_TYPES,
  FILTER_OPS,
  MAX_RUN_TARGET_ROW_IDS,
  MAX_SELECT_OPTIONS,
  MAX_TABLE_BATCH_ITEMS,
  NAME_PATTERN,
  SORT_DIRECTIONS,
  TABLE_LIMITS,
} from '@/lib/table/constants'
import { CSV_SYNC_MAX_FILE_SIZE_BYTES, CSV_SYNC_MAX_FILE_SIZE_MESSAGE } from '@/lib/table/import'
import {
  getTablePredicateTreeSizeError,
  MAX_PREDICATE_DEPTH,
  MAX_PREDICATE_GROUP_SIZE,
  MAX_PREDICATE_NODES,
  normalizeTablePredicate,
} from '@/lib/table/query-builder/predicate'

export const domainObjectSchema = <T>() => z.custom<T>(isRecordLike)

/**
 * Column types are a fixed enum derived from `COLUMN_TYPES` so callers cannot
 * send arbitrary strings the server would reject downstream.
 */
export const columnTypeSchema = z
  .enum(COLUMN_TYPES)
  .meta({ omitEnumValuesFromOpenApi: ['ttl'] as const })

/** One choice in a `select` column. `id` is the stable cell key. */
export const selectOptionSchema = z.object({
  id: requiredFieldSchema('Option id is required').describe('Stable select-option identifier.'),
  name: z
    .string()
    .min(1, 'Option name is required')
    .max(100, 'Option name must be 100 characters or less')
    .describe('Display name of the select option.'),
})

export const selectOptionsSchema = z
  .array(selectOptionSchema)
  .max(MAX_SELECT_OPTIONS, `A select column cannot have more than ${MAX_SELECT_OPTIONS} options`)

/**
 * ISO 4217 code for a `currency` column, normalized to upper case.
 *
 * Deliberately shape-only. Whether a code is one the runtime can actually
 * format is checked server-side in `validateColumnDefinition`, because this
 * same schema parses RESPONSES: pinning the boundary to the *client's* ICU
 * table would make any divergence between the two runtimes' currency lists
 * reject an entire table schema over one column's code.
 */
export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'Must be a 3-letter ISO 4217 currency code, e.g. USD')
  .overwrite((code) => code.toUpperCase())

/**
 * Cross-field rule: a `select` column must declare a non-empty option set;
 * other types must not carry options or `multiple`, and only a `currency`
 * column may carry `currencyCode`. Skipped when `type` is absent (a
 * metadata-only update on an existing column).
 */
export function refineColumnOptions(
  data: {
    type?: (typeof COLUMN_TYPES)[number]
    options?: z.infer<typeof selectOptionsSchema>
    multiple?: boolean
    currencyCode?: string
  },
  ctx: z.RefinementCtx
): void {
  // `currencyCode` on a non-currency column is inert until a later
  // convert-to-currency inherits it, silently overriding the currency the user
  // picked in that request.
  if (data.type !== undefined && data.type !== 'currency' && data.currencyCode !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['currencyCode'],
      message: 'currencyCode is only allowed on currency columns',
    })
  }
  if (data.type === 'select') {
    if (!data.options || data.options.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'A select column must define at least one option',
      })
    }
    return
  }
  if (data.type === undefined) return
  if (data.options && data.options.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['options'],
      message: 'options are only allowed on select columns',
    })
  }
  // `multiple` stored on a non-select column is inert until a later
  // convert-to-select inherits it, silently producing a multiselect.
  if (data.multiple) {
    ctx.addIssue({
      code: 'custom',
      path: ['multiple'],
      message: 'multiple is only allowed on select columns',
    })
  }
}

/**
 * Identifier for tables/columns: starts with letter or underscore, contains
 * only alphanumerics + underscores, capped at `MAX_TABLE_NAME_LENGTH`.
 */
export const tableNameSchema = z
  .string()
  .min(1, 'Name is required')
  .max(
    TABLE_LIMITS.MAX_TABLE_NAME_LENGTH,
    `Name must be ${TABLE_LIMITS.MAX_TABLE_NAME_LENGTH} characters or less`
  )
  .regex(
    NAME_PATTERN,
    'Name must start with a letter or underscore and contain only alphanumeric characters and underscores'
  )

export const columnNameSchema = z
  .string()
  .min(1, 'Column name is required')
  .max(
    TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH,
    `Column name must be ${TABLE_LIMITS.MAX_COLUMN_NAME_LENGTH} characters or less`
  )
  .regex(
    NAME_PATTERN,
    'Column name must start with a letter or underscore and contain only alphanumeric characters and underscores'
  )

const descriptionSchema = z
  .string()
  .max(
    TABLE_LIMITS.MAX_DESCRIPTION_LENGTH,
    `Description must be ${TABLE_LIMITS.MAX_DESCRIPTION_LENGTH} characters or less`
  )

export const tableScopeSchema = z.enum(['active', 'archived', 'all'])

export const tableIdParamsSchema = z.object({
  tableId: z.string().min(1).describe('Unique table identifier.'),
})

export const tableRowParamsSchema = tableIdParamsSchema.extend({
  rowId: z.string().min(1).describe('Unique table row identifier.'),
})

export const listTablesQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
  scope: tableScopeSchema.default('active'),
})

export const getTableQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
})

export const tableColumnSchema = z
  .object({
    /** Stable column id (server-assigned). Absent on legacy/ pre-backfill columns. */
    id: z.string().optional().describe('Stable server-assigned column identifier.'),
    name: columnNameSchema.describe('Column name used as the public row-data key.'),
    type: columnTypeSchema.describe('Data type of values stored in the column.'),
    required: z
      .boolean()
      .optional()
      .default(false)
      .describe('Whether inserts require a value for this column.'),
    unique: z
      .boolean()
      .optional()
      .default(false)
      .describe('Whether values must be unique across table rows.'),
    /** Set when the column is a workflow group's output. */
    workflowGroupId: z
      .string()
      .optional()
      .describe('Workflow group whose output populates this column.'),
    /** Declared options for a `select` column. */
    options: selectOptionsSchema.optional().describe('Options declared for a select column.'),
    /** A `select` column that accepts multiple options per cell. */
    multiple: z.boolean().optional().describe('Whether a select column accepts multiple options.'),
    /** ISO 4217 code for a `currency` column. */
    currencyCode: currencyCodeSchema
      .optional()
      .describe('ISO 4217 code for a currency column, normalized to uppercase.'),
  })
  .superRefine(refineColumnOptions)
  .describe('A typed column in a table schema.')

export const createTableBodySchema = z.object({
  name: tableNameSchema.describe('Table name.'),
  description: descriptionSchema.optional().describe('Optional table description.'),
  schema: z
    .object({
      columns: z
        .array(tableColumnSchema)
        .min(1, 'Table must have at least one column')
        .max(
          TABLE_LIMITS.MAX_COLUMNS_PER_TABLE,
          `Table cannot have more than ${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE} columns`
        )
        .describe('Initial typed column definitions.'),
    })
    .describe('Initial table schema.'),
  workspaceId: workspaceIdSchema,
  /**
   * Folder to create the table in. Omitted or `null` creates it at the workspace
   * root — both spellings are accepted so a client can pass the current folder
   * through unconditionally.
   */
  folderId: folderIdSchema.nullable().optional(),
  initialRowCount: z.number().int().min(0).max(100).optional(),
})

export const renameTableBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  name: tableNameSchema,
})

/** Full per-table lock set (all four flags). */
export const tableLocksSchema = z.object({
  schemaLocked: z.boolean().describe('Whether column-schema changes are locked.'),
  insertLocked: z.boolean().describe('Whether row insertion is locked.'),
  updateLocked: z.boolean().describe('Whether row updates are locked.'),
  deleteLocked: z.boolean().describe('Whether row and table deletion is locked.'),
}) satisfies z.ZodType<TableLocks>

/**
 * PATCH /api/table/[tableId] body. Every field is optional but at least one
 * must be present. `name` is a `write`-level rename; `folderId` is a
 * `write`-level move (explicit `null` moves the table to the workspace root, and
 * omission leaves the placement untouched — the tri-state is deliberate here);
 * `locks` is an admin-only governance change (a partial — only the toggled flags
 * are sent).
 */
export const updateTableBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: tableNameSchema.optional(),
    folderId: folderIdSchema.nullable().optional(),
    locks: tableLocksSchema.partial().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.name === undefined && body.locks === undefined && body.folderId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide a new name, folder, or lock changes',
        path: ['name'],
      })
    }
  })

export const createTableColumnBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  column: z
    .object({
      // Optional stable id — first-party undo of a delete re-creates the column
      // with its original id so saved (id-keyed) cell data restores correctly.
      id: z.string().optional().describe('Optional stable column identifier.'),
      name: columnNameSchema.describe('Column name used as the row-data key.'),
      type: columnTypeSchema.describe('Data type of values stored in the column.'),
      required: z.boolean().optional().describe('Whether inserts require a value.'),
      unique: z.boolean().optional().describe('Whether values must be unique.'),
      position: z.number().int().min(0).optional().describe('Zero-based insertion position.'),
      options: selectOptionsSchema.optional().describe('Options for a select column.'),
      multiple: z.boolean().optional().describe('Whether a select column accepts multiple values.'),
      currencyCode: currencyCodeSchema.optional().describe('ISO 4217 code for a currency column.'),
    })
    .superRefine(refineColumnOptions)
    .describe('Typed column definition to add.'),
})

export const updateTableColumnBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  columnName: columnNameSchema.describe('Current name of the column to update.'),
  updates: z
    .object({
      name: columnNameSchema.optional().describe('New column name.'),
      type: columnTypeSchema.optional().describe('New column data type.'),
      required: z.boolean().optional().describe('New required-value setting.'),
      unique: z.boolean().optional().describe('New uniqueness setting.'),
      options: selectOptionsSchema.optional().describe('Replacement select options.'),
      multiple: z.boolean().optional().describe('New multi-select setting.'),
      currencyCode: currencyCodeSchema.optional().describe('New ISO 4217 currency code.'),
    })
    .superRefine(refineColumnOptions)
    .describe('Column fields to update.'),
})

export const deleteTableColumnBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  columnName: columnNameSchema.describe('Name of the column to delete.'),
})

export const tableMetadataSchema = z.object({
  columnWidths: z
    .record(z.string(), z.number().positive())
    .optional()
    .describe('Column widths keyed by stable column identifier.'),
  columnOrder: z
    .array(z.string())
    .optional()
    .describe('Stable column identifiers in display order.'),
  pinnedColumns: z.array(z.string()).optional().describe('Stable identifiers of pinned columns.'),
  hiddenColumns: z.array(z.string()).optional().describe('Stable identifiers of hidden columns.'),
}) satisfies z.ZodType<TableMetadata>

export const updateTableMetadataBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  metadata: tableMetadataSchema,
})

export const rowDataSchema = domainObjectSchema<RowData>()
export const tableDefinitionSchema = domainObjectSchema<TableDefinition>()
export const tableRowSchema = domainObjectSchema<TableRow>()

/**
 * One row as the single-row routes actually emit it: the stored cells plus
 * position, with timestamps already serialized.
 *
 * Deliberately not {@link tableRowSchema}. That one describes a `TableRow`,
 * which carries the per-cell `executions` sidecar and `Date` objects — accurate
 * for the list and query routes, which return exactly that, and wrong for the
 * single-row routes, which have always projected a narrower object with ISO
 * strings. Two shapes on the wire need two schemas; collapsing them would make
 * one of the two lie to its clients.
 */
export const tableRowWireSchema = z.object({
  id: z.string(),
  data: rowDataSchema,
  position: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/**
 * Plain-object base for the single-row insert body. Kept un-refined so callers
 * (e.g. the v1 public contract) can `.omit()` fields before applying
 * {@link rowAnchorMutexRefine} — Zod forbids `.omit()` on a refined schema.
 */
export const insertTableRowBodyBaseSchema = z.object({
  workspaceId: workspaceIdSchema,
  data: rowDataSchema.describe('Row cells keyed by column name.'),
  [PRIVATE_SECRET_PROVENANCE_FIELD]: privateSecretProvenanceBundleSchema
    .optional()
    .describe('Private encrypted secret provenance for trusted internal callers.'),
  position: z.number().int().min(0).optional(),
  /** Fractional ordering: insert directly after this row id. Takes precedence over `position`. */
  afterRowId: z.string().min(1).optional().describe('Row after which to insert the new row.'),
  /** Fractional ordering: insert directly before this row id. Takes precedence over `position`. */
  beforeRowId: z.string().min(1).optional().describe('Row before which to insert the new row.'),
})

/** `afterRowId` and `beforeRowId` are mutually exclusive insert anchors. */
export const rowAnchorMutexRefine = [
  (data: { afterRowId?: string; beforeRowId?: string }) => !data.afterRowId || !data.beforeRowId,
  { message: 'afterRowId and beforeRowId are mutually exclusive' },
] as const

export const insertTableRowBodySchema = insertTableRowBodyBaseSchema.refine(...rowAnchorMutexRefine)

/**
 * POST `/api/table/[tableId]/rows/upsert` body — insert-or-update keyed by a
 * unique column name. `conflictTarget` is optional (server picks a single
 * unique column when omitted).
 */
export const upsertTableRowBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  data: rowDataSchema.describe('Row cells keyed by column name.'),
  conflictTarget: z.string().min(1).optional().describe('Unique column used to detect a conflict.'),
  [PRIVATE_SECRET_PROVENANCE_FIELD]: privateSecretProvenanceBundleSchema
    .optional()
    .describe('Private encrypted secret provenance for trusted internal callers.'),
})

export const batchInsertTableRowsBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    [PRIVATE_SECRET_PROVENANCE_FIELD]: privateSecretProvenanceBundleSchema.optional(),
    rows: z
      .array(rowDataSchema)
      .min(1, 'At least one row is required')
      .max(
        TABLE_LIMITS.MAX_BATCH_INSERT_SIZE,
        `Cannot insert more than ${TABLE_LIMITS.MAX_BATCH_INSERT_SIZE} rows per batch`
      ),
    /** Fractional ordering: exact per-row order keys (undo restore). */
    orderKeys: z.array(z.string().min(1)).max(TABLE_LIMITS.MAX_BATCH_INSERT_SIZE).optional(),
  })
  .refine((data) => !data.orderKeys || data.orderKeys.length === data.rows.length, {
    message: 'orderKeys array length must match rows array length',
  })

/**
 * POST `/api/table/[tableId]/rows` body — accepts either a batch payload
 * (`{ rows: [...] }`) or a single-row payload (`{ data: {...} }`). Branches
 * narrow on `'rows' in body` since the discriminator is the shape, not a
 * literal field. Order matters: the batch schema is checked first so payloads
 * that include `rows` are routed to batch insert.
 */
export const insertTableRowsBodySchema = z.union([
  batchInsertTableRowsBodySchema,
  insertTableRowBodySchema,
])

export const updateTableRowBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  data: rowDataSchema.describe('Partial row-data patch keyed by column name.'),
  [PRIVATE_SECRET_PROVENANCE_FIELD]: privateSecretProvenanceBundleSchema
    .optional()
    .describe('Private encrypted secret provenance for trusted internal callers.'),
})

export const batchUpdateTableRowsBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  [PRIVATE_SECRET_PROVENANCE_FIELD]: privateSecretProvenanceBundleSchema.optional(),
  updates: z
    .array(
      z.object({
        rowId: z.string().min(1),
        data: rowDataSchema,
      })
    )
    .min(1, 'At least one update is required')
    .max(
      TABLE_LIMITS.MAX_BULK_OPERATION_SIZE,
      `Cannot update more than ${TABLE_LIMITS.MAX_BULK_OPERATION_SIZE} rows per batch`
    )
    .refine((updates) => new Set(updates.map((update) => update.rowId)).size === updates.length, {
      message: 'updates must not contain duplicate rowId values',
    }),
})

/**
 * Filter object that requires at least one key. Bulk delete/update operations
 * cannot accept an empty filter — that would target every row in the table,
 * which is rejected by `buildFilterClause` downstream.
 */
const nonEmptyFilterSchema = domainObjectSchema<Filter>().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Filter must not be empty' }
)

const filterSchema = domainObjectSchema<Filter>()

/* --------------------------- v2 predicate grammar --------------------------- */

/**
 * Body cap for the row-query routes. A query body is a predicate tree plus a
 * cursor; the largest legitimate one — a 100-member predicate with 1000-element
 * `in` lists — is comfortably under 1 MB. The 50 MB platform default would let a
 * caller buffer two orders of magnitude more before any schema check runs.
 */
export const TABLE_QUERY_MAX_BODY_BYTES = 1024 * 1024

/** Max sort keys — more than a few is already a smell. */
const MAX_SORT_KEYS = 16

/**
 * The published predicate grammar.
 *
 * Without it a caller reads an untyped operand and an operator enum with no
 * semantics, and the natural guess — SQL's own `%` wildcard — matches zero rows
 * under a 200 with nothing saying why. Stated on the operator and on the tree so
 * it reaches the OpenAPI description of every endpoint taking a predicate.
 */
const PREDICATE_OPERATOR_GRAMMAR = [
  'Operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`; `in`/`nin` take arrays; `isEmpty`, `isNotEmpty`, `isNull`, and `isNotNull` take no operand.',
  'Text operators are `contains`, `ncontains`, `startsWith`, `endsWith`, `like`, `nlike`, `ilike`, and `nilike`. Contains variants are case-insensitive and literal; `like`/`nlike` are case-sensitive, while `ilike`/`nilike` are case-insensitive.',
  '`*` is the only wildcard; `%`, `_`, and backslash are literal.',
  'For `select` columns, single-select accepts `eq`, `ne`, `in`, `nin`; multi-select accepts `contains`, `ncontains`. Option names resolve to IDs.',
].join(' ')

/**
 * v2 filter wire format: the typed `{ all | any: [...] }` predicate tree (same
 * shape the engine consumes). Structure is validated here; schema-awareness
 * (unknown column, json-op rejection) is enforced server-side by
 * `validatePredicate` once the table's columns are known.
 */
/**
 * Both node shapes are `strictObject`, and that is load-bearing rather than
 * fussiness. Zod strips unrecognized keys by default, so a hybrid node carrying
 * BOTH a group key and a leaf's `field`/`op`/`value` parsed clean against the
 * group branch with the leaf half silently deleted. On the bulk paths that turns
 * "delete archived rows for tenant acme" into "delete every row for tenant acme".
 * `validatePredicate`'s hybrid guard could never catch it — the keys were gone
 * before it ran. Strict on BOTH branches is required: strict on the group alone
 * would just fall through to the leaf branch, which is the more dangerous reading.
 */
const predicateLeafObjectSchema = z.strictObject({
  field: z
    .string()
    .min(1, 'field is required')
    .max(128)
    .describe(
      'Column name to compare, or one of the system fields `id`, `createdAt`, `updatedAt`.'
    ),
  op: z.enum(FILTER_OPS).describe(PREDICATE_OPERATOR_GRAMMAR),
  value: z
    .unknown()
    .optional()
    .describe(
      'Operand. A scalar for the comparison operators, an array for `in`/`nin`, a pattern for the matching operators, and omitted for `isEmpty`/`isNotEmpty`/`isNull`/`isNotNull`.'
    ),
})

// double-cast-allowed: `z.unknown()` keeps the runtime permissive (a leaf value
// is arbitrary JSON), but infers `unknown`, which is wider than
// `Predicate['value']`. The narrowing is type-level only — nothing is coerced.
const predicateLeafSchema = predicateLeafObjectSchema as unknown as z.ZodType<Predicate>

const predicateNodeSchema: z.ZodType<PredicateNode> = z.lazy(() =>
  z.union([predicateGroupSchema, predicateLeafSchema])
)

const predicateTreeSchema: z.ZodType<TablePredicate> = z.lazy(() =>
  z.union([
    // `.min(1)`: an empty group compiles to no WHERE clause, which on the bulk
    // delete/update paths reads as "match everything" rather than "match nothing".
    z.strictObject({
      all: z
        .array(predicateNodeSchema)
        .min(1, 'A filter group must contain at least one condition')
        .max(MAX_PREDICATE_GROUP_SIZE),
    }),
    z.strictObject({
      any: z
        .array(predicateNodeSchema)
        .min(1, 'A filter group must contain at least one condition')
        .max(MAX_PREDICATE_GROUP_SIZE),
    }),
  ])
)
const predicateGroupSchema = predicateTreeSchema

const predicateBoundarySchema = z.unknown().superRefine((value, ctx) => {
  const problem = getTablePredicateTreeSizeError(value)
  if (problem) ctx.addIssue({ code: 'custom', message: problem })
})

/**
 * The published JSON Schema for a predicate tree.
 *
 * `predicateSchema` is a `pipe` whose input side is `z.unknown()` — the size
 * guard has to run before the recursive union so pathological input is a `400`
 * rather than a stack overflow — and `z.toJSONSchema` documents a pipe from its
 * input. That published the most consequential shape in the API as a bare
 * description: the leaf keys `field`/`op`/`value` were named nowhere in the
 * contract and were discoverable only by reading an example, so a caller
 * guessing `{column, operator, value}` got a `400` with nothing to correct
 * against. This object is merged in through `.meta()` so the shape is published
 * without moving the guard.
 *
 * Every bound below is read from the runtime constant that enforces it, and
 * `tables-predicate.test.ts` pins the published operator set against
 * `FILTER_OPS`, so the two cannot drift.
 */
const PREDICATE_LEAF_JSON_SCHEMA = {
  type: 'object',
  title: 'Predicate condition',
  description: 'One column comparison.',
  properties: {
    field: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      description:
        'Column name to compare, or one of the system fields `id`, `createdAt`, `updatedAt`.',
    },
    op: {
      type: 'string',
      enum: [...FILTER_OPS],
      description: PREDICATE_OPERATOR_GRAMMAR,
    },
    value: {
      description:
        'Operand. A scalar for the comparison operators, an array of at most 1000 entries for `in`/`nin`, a pattern for the matching operators, and omitted for `isEmpty`/`isNotEmpty`/`isNull`/`isNotNull`.',
    },
  },
  required: ['field', 'op'],
  additionalProperties: false,
} as const

/**
 * A group's members are the schema itself, so each component carries a `$ref`
 * to its own id. The self-reference is what makes the recursion resolvable from
 * inside a single `$defs` entry — a reference to a sibling component would be
 * dangling wherever only one of the two is reachable, which is exactly the
 * shape the table-view body has.
 */
const predicateGroupJsonSchema = (key: 'all' | 'any', conjunction: string, selfRef: string) =>
  ({
    type: 'object',
    description: `Matches a row when ${conjunction} member matches.`,
    properties: {
      [key]: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_PREDICATE_GROUP_SIZE,
        description: `Members combined with ${key === 'all' ? 'AND' : 'OR'}. An empty group is rejected, because it would compile to no filter at all.`,
        items: {
          description: 'A nested group, or a single condition.',
          anyOf: [{ $ref: selfRef }, PREDICATE_LEAF_JSON_SCHEMA],
        },
      },
    },
    required: [key],
    additionalProperties: false,
  }) as const

const predicateGroupsJsonSchema = (selfRef: string) =>
  [
    predicateGroupJsonSchema('all', 'every', selfRef),
    predicateGroupJsonSchema('any', 'at least one', selfRef),
  ] as const

/**
 * Stated once here rather than on each operation that accepts a predicate.
 * The NULL clause is the surprising half: `ncontains`, `nlike`, and `nilike`
 * emit an explicit `IS NULL OR NOT …` arm, and `ne`/`nin` negate a JSONB
 * containment test that is false for an absent key, so all of them return rows
 * whose column is null.
 *
 * Multi-select is not an exception to that, though the published sentence used
 * to claim it was: its `ncontains` is `NOT (data @> '{"tags":["opt"]}')`, and
 * `data` is never NULL, so an absent or null cell makes the containment test
 * false and the negation true — the same include-nulls behaviour as every other
 * negation. Pinned by `__tests__/sql.test.ts`.
 */
const PREDICATE_LIMITS_DESCRIPTION = `Limits: ${MAX_PREDICATE_GROUP_SIZE} members per group, ${MAX_PREDICATE_DEPTH} levels, and ${MAX_PREDICATE_NODES} nodes.`
const PREDICATE_NEGATION_DESCRIPTION =
  'The negating operators include nulls and absent cells, multi-select included; combine with `isNotNull` or `isNotEmpty` to exclude them.'
const PREDICATE_OPERATOR_SUMMARY =
  'Pattern operators use `*` as the only wildcard; `%`, `_`, and backslash are literal. Select operators: single-select uses `eq`/`ne`/`in`/`nin`; multi-select uses `contains`/`ncontains`; option names resolve to IDs. Full operand rules are documented on `op`.'
const PREDICATE_TREE_DESCRIPTION = `Recursive non-empty \`all\`/\`any\` groups containing groups or conditions; the root cannot be a condition. ${PREDICATE_LIMITS_DESCRIPTION} ${PREDICATE_NEGATION_DESCRIPTION} ${PREDICATE_OPERATOR_SUMMARY}`
const PREDICATE_INPUT_DESCRIPTION = `One condition or a recursive \`all\`/\`any\` group, normalized to a grouped predicate. ${PREDICATE_LIMITS_DESCRIPTION} ${PREDICATE_NEGATION_DESCRIPTION} ${PREDICATE_OPERATOR_SUMMARY}`

/**
 * The canonical grouped predicate schema for dual-grammar boundaries. Keeping
 * its root group-only prevents a legacy filter with columns named `field`,
 * `op`, and `value` from being reinterpreted as a v2 predicate.
 */
const documentedPredicateSchema = predicateBoundarySchema.pipe(predicateTreeSchema).meta({
  id: 'TablePredicate',
  title: 'Table predicate',
  description: PREDICATE_TREE_DESCRIPTION,
  type: 'object',
  oneOf: [...predicateGroupsJsonSchema('#/$defs/TablePredicate')],
})

// double-cast-allowed: the pipe's inferred input is `unknown`, and letting TS widen the recursive lazy union through it makes typecheck OOM
export const predicateSchema = documentedPredicateSchema as unknown as z.ZodType<TablePredicate>

/**
 * The v2-only input schema accepts either a root leaf or a logical group and
 * always outputs the canonical grouped shape. The depth/size guard runs before
 * recursive parsing so pathological input returns a validation error, not a
 * stack overflow.
 */
export const predicateInputSchema = predicateBoundarySchema
  .pipe(predicateNodeSchema)
  .transform(normalizeTablePredicate)
  .meta({
    id: 'TablePredicateInput',
    title: 'Table predicate input',
    description: PREDICATE_INPUT_DESCRIPTION,
    oneOf: [
      ...predicateGroupsJsonSchema('#/$defs/TablePredicateInput'),
      PREDICATE_LEAF_JSON_SCHEMA,
    ],
  }) as z.ZodType<TablePredicate, PredicateNode>

/**
 * v2 sort wire format: an ordered list of `{ field, direction }`.
 *
 * The element is `.strict()` because a body's own `.strict()` binds its top
 * level only. Left open, `sort: [{ field, direction, nulls: 'last' }]` answered
 * 200 with the `nulls` request silently dropped — a caller asking for
 * null-ordering got default ordering and no signal. That is the same failure as
 * the v1-shaped `filter` key returning an unfiltered page, one level down.
 */
export const sortSpecSchema: z.ZodType<SortSpec> = z
  .array(
    z
      .object({
        field: z.string().min(1, 'field is required').max(128).describe('Column name to sort by.'),
        direction: z.enum(SORT_DIRECTIONS).describe('Sort direction for this column.'),
      })
      .strict()
  )
  .max(MAX_SORT_KEYS)

/**
 * Bulk update/delete filter accepts either the v2 predicate tree (v2 block /
 * agent) or the legacy `$`-operator object (v1 callers / stored workflows).
 */
const bulkFilterSchema = z.union([predicateSchema, nonEmptyFilterSchema])

const optionalPositiveLimit = (max: number, label: string) =>
  z.preprocess(
    (value) => (value === null || value === undefined || value === '' ? undefined : Number(value)),
    z
      .number()
      .int(`${label} must be an integer`)
      .min(1, `${label} must be at least 1`)
      .max(max, `Cannot ${label.toLowerCase()} more than ${max} rows per operation`)
      .optional()
  )

export const deleteTableRowBodySchema = z.object({
  workspaceId: workspaceIdSchema,
})

export const deleteTableRowsBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    filter: bulkFilterSchema.optional(),
    limit: optionalPositiveLimit(TABLE_LIMITS.MAX_BULK_OPERATION_SIZE, 'Limit').optional(),
    rowIds: z
      .array(z.string().min(1))
      .min(1, 'At least one row ID is required')
      .max(
        TABLE_LIMITS.MAX_BULK_OPERATION_SIZE,
        `Cannot delete more than ${TABLE_LIMITS.MAX_BULK_OPERATION_SIZE} rows per operation`
      )
      .optional(),
  })
  .refine((data) => Boolean(data.filter) !== Boolean(data.rowIds), {
    message: 'Provide either filter or rowIds, but not both',
  })

/**
 * Query-param transport for a structured value: `requestJson` serializes
 * objects/arrays into a single JSON-string param, and this decodes it before
 * the real schema runs. Non-JSON strings pass through untouched so the inner
 * schema produces the real error; already-parsed values (POST bodies reusing a
 * schema) are untouched too.
 */
const jsonQueryValue = <S extends z.ZodType>(schema: S) =>
  z.preprocess((value) => {
    if (typeof value !== 'string' || value === '') return value
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }, schema)

/** Unrefined base so v1 contracts can `.extend()` — consumers use {@link tableRowsQuerySchema}. */
export const tableRowsQueryBaseSchema = z.object({
  workspaceId: workspaceIdSchema,
  // Dual-grammar during the v2 transition: the strict predicate tree wins the
  // union; anything else falls through to the legacy `$`-object. Same for sort:
  // an ordered spec array vs the legacy `{col: dir}` record.
  filter: jsonQueryValue(z.union([predicateSchema, domainObjectSchema<Filter>()])).optional(),
  sort: jsonQueryValue(z.union([sortSpecSchema, domainObjectSchema<Sort>()])).optional(),
  /**
   * Keyset cursor `(orderKey, id)` for the default row order — each page is an index seek
   * instead of OFFSET's scan-and-discard. Mutually exclusive with `sort` (cursors only make
   * sense on the default order); takes precedence over `offset`.
   */
  after: jsonQueryValue(domainObjectSchema<TableRowsCursor>()).optional(),
  limit: z
    .preprocess(
      (value) =>
        value === null || value === undefined || value === '' ? undefined : Number(value),
      z
        .number({ error: 'Limit must be a number' })
        .int('Limit must be an integer')
        .min(1, 'Limit must be at least 1')
        .max(TABLE_LIMITS.MAX_QUERY_LIMIT, `Limit cannot exceed ${TABLE_LIMITS.MAX_QUERY_LIMIT}`)
        .optional()
    )
    .default(TABLE_LIMITS.DEFAULT_QUERY_LIMIT),
  offset: z
    .preprocess(
      (value) =>
        value === null || value === undefined || value === '' ? undefined : Number(value),
      z
        .number({ error: 'Offset must be a number' })
        .int('Offset must be an integer')
        .min(0, 'Offset must be 0 or greater')
        .optional()
    )
    .default(0),
  /**
   * Absent, null, and empty all fall through to the `true` default, so a bare request still
   * gets its count. Everything else goes to {@link booleanQueryFlagSchema}, which accepts a real
   * boolean as well as the URL strings — `requestJson` parses this schema on the CLIENT before
   * building the URL, so the value arrives as the caller's own type, and a string-only coercion
   * silently read the grid's `includeTotal: param === 0` as `false` — leaving `totalCount` null on
   * every table, and select-all falling back to the unfiltered row count.
   *
   * Unparseable values now reject rather than resolving to `false`, matching `limit` and `offset`
   * in this same schema, which have always thrown on garbage.
   */
  includeTotal: z
    .preprocess(
      (value) => (value === null || value === undefined || value === '' ? undefined : value),
      booleanQueryFlagSchema.optional()
    )
    .default(true),
})

const unboundedTableRowsLimitSchema = z.preprocess(
  (value) => (value === null || value === undefined || value === '' ? undefined : Number(value)),
  z
    .number({ error: 'Limit must be a number' })
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .optional()
)

export const tableRowsQuerySchema = tableRowsQueryBaseSchema
  .extend({ limit: unboundedTableRowsLimitSchema })
  .refine((data) => !(data.after && data.sort), {
    message: 'after cursor cannot be combined with sort — cursors paginate the default order',
  })

export const updateRowsByFilterBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  filter: bulkFilterSchema,
  data: rowDataSchema.describe('Row-data patch applied to every matching row.'),
  limit: optionalPositiveLimit(TABLE_LIMITS.MAX_BULK_OPERATION_SIZE, 'Limit')
    .optional()
    .describe('Maximum matching rows to update.'),
  [PRIVATE_SECRET_PROVENANCE_FIELD]: privateSecretProvenanceBundleSchema
    .optional()
    .describe('Private encrypted secret provenance for trusted internal callers.'),
})

const successResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  })

const tableColumnsResponseDataSchema = z.object({
  columns: z.array(tableColumnSchema),
})

export const listTablesContract = defineRouteContract({
  method: 'GET',
  path: '/api/table',
  query: listTablesQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        tables: z.array(tableDefinitionSchema),
        totalCount: z.number(),
      })
    ),
  },
})
export type ListTablesResponse = ContractJsonResponse<typeof listTablesContract>

export const createTableContract = defineRouteContract({
  method: 'POST',
  path: '/api/table',
  body: createTableBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        table: tableDefinitionSchema,
        message: z.string(),
      })
    ),
  },
})

/**
 * Kickoff body for an asynchronous large-CSV import into a NEW table. The file is
 * already uploaded to storage (the client sends its `fileKey`); the route creates an
 * `importing` table and runs the load in the background.
 */
export const importTableAsyncBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  fileKey: requiredFieldSchema('fileKey is required'),
  fileName: requiredFieldSchema('fileName is required'),
  /** Folder to create the imported table in; omitted or `null` imports to the workspace root. */
  folderId: folderIdSchema.nullable().optional(),
  /**
   * Whether the source object is deleted once the import is terminal. Defaults to true (the upload
   * flow stores a single-use temp object); pass false when importing an existing workspace file
   * (e.g. the file viewer's "Import as a table") that must survive the import.
   */
  deleteSourceFile: z.boolean().optional(),
  /**
   * IANA zone used to interpret naive datetime strings in the file (Excel and
   * Sheets exports carry no offset). Defaults to the importing user's saved
   * timezone, else UTC.
   */
  timezone: ianaTimezoneSchema.optional(),
})

export type ImportTableAsyncBody = z.input<typeof importTableAsyncBodySchema>

export const getTableContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/[tableId]',
  params: tableIdParamsSchema,
  query: getTableQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ table: tableDefinitionSchema })),
  },
})
export type GetTableResponse = ContractJsonResponse<typeof getTableContract>

export const renameTableContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/table/[tableId]',
  params: tableIdParamsSchema,
  body: renameTableBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ table: tableDefinitionSchema })),
  },
})

/**
 * Superset of {@link renameTableContract} on the same PATCH endpoint: accepts a
 * `name` rename and/or a `locks` change. The route applies its own permission
 * split — `name` needs workspace `write`, `locks` needs `admin`.
 */
export const updateTableContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/table/[tableId]',
  params: tableIdParamsSchema,
  body: updateTableBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ table: tableDefinitionSchema })),
  },
})

export type TableLocksInput = z.input<typeof tableLocksSchema>
export type UpdateTableBody = z.input<typeof updateTableBodySchema>
export type UpdateTableResponse = ContractJsonResponse<typeof updateTableContract>

export const deleteTableContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/table/[tableId]',
  params: tableIdParamsSchema,
  query: getTableQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ message: z.string() })),
  },
})

export const restoreTableContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/restore',
  params: tableIdParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ table: tableDefinitionSchema })),
  },
})

export const addTableColumnContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/columns',
  params: tableIdParamsSchema,
  body: createTableColumnBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(tableColumnsResponseDataSchema),
  },
})

export const updateTableColumnContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/table/[tableId]/columns',
  params: tableIdParamsSchema,
  body: updateTableColumnBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(tableColumnsResponseDataSchema),
  },
})

export const deleteTableColumnContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/table/[tableId]/columns',
  params: tableIdParamsSchema,
  body: deleteTableColumnBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(tableColumnsResponseDataSchema),
  },
})

export const updateTableMetadataContract = defineRouteContract({
  method: 'PUT',
  path: '/api/table/[tableId]/metadata',
  params: tableIdParamsSchema,
  body: updateTableMetadataBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ metadata: tableMetadataSchema })),
  },
})

export const listTableRowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/[tableId]/rows',
  params: tableIdParamsSchema,
  query: tableRowsQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        rows: z.array(tableRowSchema),
        rowCount: z.number(),
        totalCount: z.number().nullable(),
        limit: z.number(),
        offset: z.number(),
        /** Non-null when more rows exist — a page may be cut by the byte budget
         *  before reaching `limit`, so page fullness is not a termination signal. */
        nextCursor: z.string().nullable(),
      })
    ),
  },
})

/**
 * v2 query surface: typed `predicate`/`sort` objects + opaque cursor pagination.
 * No `offset` (the cursor encodes paging state) and no after/sort refine (the
 * cursor carries the sort context). Structure is validated here; column-level
 * validation (unknown field, json-op) runs server-side via `validatePredicate`.
 */
export const rowQueryBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  predicate: predicateInputSchema.optional(),
  sort: sortSpecSchema.optional(),
  columns: z
    .array(
      requiredFieldSchema('Column reference must not be empty').max(
        MAX_ID_LENGTH,
        'Column reference is too long'
      )
    )
    .max(
      TABLE_LIMITS.MAX_COLUMNS_PER_TABLE,
      `Cannot select more than ${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE} columns`
    )
    .optional()
    .describe(
      'Stable column identifiers or column names to include. Omit or pass an empty array for all columns; a reference that matches no column is ignored.'
    ),
  // Omitted limit returns the ENTIRE matching result, failing fast (400) when
  // it exceeds the response byte budget. An explicit limit caps the page row
  // count; the byte budget may still end a page early with nextCursor set.
  limit: unboundedTableRowsLimitSchema,
  cursor: z.string().min(1, 'cursor must be a non-empty token').optional(),
})

export type RowQueryBody = z.input<typeof rowQueryBodySchema>

export const rowQueryContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/query',
  params: tableIdParamsSchema,
  body: rowQueryBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        rows: z.array(tableRowSchema),
        rowCount: z.number(),
        totalCount: z.number().nullable(),
        limit: z.number(),
        nextCursor: z.string().nullable(),
      })
    ),
  },
})
export type RowQueryResponse = ContractJsonResponse<typeof rowQueryContract>

export const findTableRowsQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
  q: requiredFieldSchema('Search query is required'),
  filter: jsonQueryValue(z.union([predicateSchema, domainObjectSchema<Filter>()])).optional(),
  sort: jsonQueryValue(z.union([sortSpecSchema, domainObjectSchema<Sort>()])).optional(),
})

/** One matching cell: its 0-based ordinal in the filtered+sorted view, its row id, and the column name. */
export const tableFindMatchSchema = z.object({
  ordinal: z.number().int(),
  rowId: z.string(),
  /** Stable column id of the matching cell (JSONB storage key), not the display name. */
  column: z.string(),
})

export const findTableRowsContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/[tableId]/rows/find',
  params: tableIdParamsSchema,
  query: findTableRowsQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        matches: z.array(tableFindMatchSchema),
        truncated: z.boolean(),
      })
    ),
  },
})
export type FindTableRowsQuery = z.input<typeof findTableRowsQuerySchema>
export type FindTableRowsResponse = ContractJsonResponse<typeof findTableRowsContract>
export type TableFindMatch = z.output<typeof tableFindMatchSchema>

export const createTableRowContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/rows',
  params: tableIdParamsSchema,
  body: insertTableRowBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        row: tableRowSchema,
        message: z.string(),
      })
    ),
  },
})

export const batchCreateTableRowsContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/rows',
  params: tableIdParamsSchema,
  body: batchInsertTableRowsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        rows: z.array(tableRowSchema),
        insertedCount: z.number(),
        message: z.string(),
      })
    ),
  },
})

/**
 * Server-side contract for `POST /api/table/[tableId]/rows`. Accepts the
 * union body so the route can handle single and batch insert in one
 * `parseRequest` call. Clients use the resource-specific contracts above
 * (`createTableRowContract` / `batchCreateTableRowsContract`) to get a
 * narrow response type.
 */
export const insertTableRowsContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/rows',
  params: tableIdParamsSchema,
  body: insertTableRowsBodySchema,
  response: {
    mode: 'json',
    schema: z.union([
      successResponseSchema(
        z.object({
          row: tableRowSchema,
          message: z.string(),
        })
      ),
      successResponseSchema(
        z.object({
          rows: z.array(tableRowSchema),
          insertedCount: z.number(),
          message: z.string(),
        })
      ),
    ]),
  },
})

export type TableIdParamsInput = z.input<typeof tableIdParamsSchema>
export type TableRowParamsInput = z.input<typeof tableRowParamsSchema>
export type TableRowsQueryInput = z.input<typeof tableRowsQuerySchema>
export type CreateTableBodyInput = z.input<typeof createTableBodySchema>
export type CreateTableColumnBodyInput = z.input<typeof createTableColumnBodySchema>
export type UpdateTableColumnBodyInput = z.input<typeof updateTableColumnBodySchema>
export type InsertTableRowBodyInput = z.input<typeof insertTableRowBodySchema>
export type BatchInsertTableRowsBodyInput = z.input<typeof batchInsertTableRowsBodySchema>
export type BatchUpdateTableRowsBodyInput = z.input<typeof batchUpdateTableRowsBodySchema>
export type UpdateTableRowBodyInput = z.input<typeof updateTableRowBodySchema>
// CSV import form schemas
//
// Both `/api/table/import-csv` and `/api/table/[tableId]/import-csv` parse a
// `multipart/form-data` body, so these schemas are validated *form-field by
// form-field* in the routes (not as a single contract body).

export const csvFileSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    if (typeof File === 'undefined' || !(value instanceof File)) {
      ctx.addIssue({ code: 'custom', message: 'CSV file is required' })
      return
    }
    if (value.size > CSV_SYNC_MAX_FILE_SIZE_BYTES) {
      ctx.addIssue({
        code: 'custom',
        message: CSV_SYNC_MAX_FILE_SIZE_MESSAGE,
      })
    }
  })
  .transform((value) => value as File)

export const csvImportFormSchema = z.object({
  file: csvFileSchema,
  workspaceId: z.string({ error: 'Workspace ID is required' }).min(1, 'Workspace ID is required'),
  /** Folder to create the imported table in; omitted imports to the workspace root. */
  folderId: folderIdSchema.optional(),
})

export const csvImportModeSchema = z.enum(['append', 'replace'])

export const csvExtensionSchema = z.enum(['csv', 'tsv'], {
  error: 'Only CSV and TSV files are supported',
})

/**
 * Kickoff body for an asynchronous CSV import into an EXISTING table (append/replace).
 * The file is already uploaded to storage; `mapping`/`createColumns` are the client's
 * resolved column mapping (the dialog computes them from its preview).
 */
export const importIntoTableAsyncBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  fileKey: requiredFieldSchema('fileKey is required'),
  fileName: requiredFieldSchema('fileName is required'),
  mode: csvImportModeSchema,
  mapping: z.record(z.string(), z.string().nullable()).optional(),
  createColumns: z.array(z.string()).optional(),
  /**
   * IANA zone used to interpret naive datetime strings in the file (Excel and
   * Sheets exports carry no offset). Defaults to the importing user's saved
   * timezone, else UTC.
   */
  timezone: ianaTimezoneSchema.optional(),
})

export type ImportIntoTableAsyncBody = z.input<typeof importIntoTableAsyncBodySchema>

/**
 * `createColumns` form field — a JSON-encoded array of CSV header names that
 * the import should auto-create as new columns on the target table.
 */
export const csvImportCreateColumnsSchema = z.unknown().transform((value, ctx): string[] => {
  if (typeof value !== 'string') {
    ctx.addIssue({ code: 'custom', message: 'createColumns must be valid JSON' })
    return z.NEVER
  }
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.some((h) => typeof h !== 'string')) {
      ctx.addIssue({
        code: 'custom',
        message: 'createColumns must be a JSON array of CSV header names',
      })
      return z.NEVER
    }
    return parsed as string[]
  } catch {
    ctx.addIssue({ code: 'custom', message: 'createColumns must be valid JSON' })
    return z.NEVER
  }
})

/**
 * `format` query param for the table export route. Lower-cases the input
 * before validating against the supported formats and defaults to `'csv'`.
 */
export const tableExportFormatSchema = z
  .preprocess(
    (value) => (typeof value === 'string' ? value.toLowerCase() : value),
    z.enum(['csv', 'json'])
  )
  .default('csv')

export const exportTableAsyncBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  format: z.enum(['csv', 'json']).default('csv').describe('Export file format.'),
})

export type ExportTableAsyncBody = z.input<typeof exportTableAsyncBodySchema>

export const tableJobSummarySchema = z.object({
  jobId: z.string(),
  tableId: z.string(),
  tableName: z.string(),
  status: z.enum(['running', 'ready', 'failed', 'canceled']),
  rowsProcessed: z.number(),
  format: z.enum(['csv', 'json']),
  hasResult: z.boolean(),
  error: z.string().nullable(),
})

export type TableJobSummary = z.output<typeof tableJobSummarySchema>

export const listTableJobsQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
  type: z.literal('export'),
})

/**
 * Workspace-scoped job listing the header tray polls. Export-only today: exports are excluded
 * from the table-level job derivation (they run concurrently with other jobs), so this is their
 * dedicated read path — running jobs plus recently-finished ones for re-download.
 */
export const listTableJobsContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/jobs',
  query: listTableJobsQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ jobs: z.array(tableJobSummarySchema) })),
  },
})

export const exportDownloadQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
  jobId: requiredFieldSchema('Job ID is required'),
})

/**
 * `mapping` form field — a JSON-encoded `CsvHeaderMapping` (CSV header →
 * column name, or `null` to skip the header).
 */
export const csvImportMappingSchema = z.unknown().transform((value, ctx): CsvHeaderMapping => {
  if (typeof value !== 'string') {
    ctx.addIssue({ code: 'custom', message: 'mapping must be valid JSON' })
    return z.NEVER
  }
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      ctx.addIssue({
        code: 'custom',
        message: 'mapping must be a JSON object mapping CSV headers to column names',
      })
      return z.NEVER
    }
    return parsed as CsvHeaderMapping
  } catch {
    ctx.addIssue({ code: 'custom', message: 'mapping must be valid JSON' })
    return z.NEVER
  }
})

export const upsertTableRowContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/rows/upsert',
  params: tableIdParamsSchema,
  body: upsertTableRowBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        row: tableRowWireSchema,
        operation: z.enum(['insert', 'update']),
        message: z.string(),
      })
    ),
  },
})

/**
 * Reads one row. The sibling of {@link updateTableRowContract} and
 * {@link deleteTableRowContract}, which take their workspace scope from a body;
 * a GET has none, so it is asserted on the query string instead.
 */
export const getTableRowContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/[tableId]/rows/[rowId]',
  params: tableRowParamsSchema,
  query: getTableQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ row: tableRowWireSchema })),
  },
})

export const updateTableRowContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/table/[tableId]/rows/[rowId]',
  params: tableRowParamsSchema,
  body: updateTableRowBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        row: tableRowWireSchema,
        message: z.string(),
      })
    ),
  },
})

export const batchUpdateTableRowsContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/table/[tableId]/rows',
  params: tableIdParamsSchema,
  body: batchUpdateTableRowsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        message: z.string(),
        updatedCount: z.number(),
        updatedRowIds: z.array(z.string()),
      })
    ),
  },
})

export const updateTableRowsByFilterContract = defineRouteContract({
  method: 'PUT',
  path: '/api/table/[tableId]/rows',
  params: tableIdParamsSchema,
  body: updateRowsByFilterBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        message: z.string(),
        updatedCount: z.number(),
        updatedRowIds: z.array(z.string()).optional(),
      })
    ),
  },
})

export const deleteTableRowContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/table/[tableId]/rows/[rowId]',
  params: tableRowParamsSchema,
  body: deleteTableRowBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        message: z.string(),
        deletedCount: z.number(),
      })
    ),
  },
})

export const enrichmentDetailParamsSchema = tableRowParamsSchema.extend({
  groupId: z.string().min(1),
})

/**
 * Per-(row, group) enrichment cascade breakdown. Modeled as a domain object so
 * the `EnrichmentRunDetail` TS type stays the single source of truth (matching
 * `tableRowSchema` / `tableDefinitionSchema`). `null` when the cell has no
 * recorded run or the run predates this feature.
 */
export const getEnrichmentDetailContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/[tableId]/rows/[rowId]/enrichment/[groupId]',
  params: enrichmentDetailParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({ detail: domainObjectSchema<EnrichmentRunDetail>().nullable() })
    ),
  },
})
export type GetEnrichmentDetailResponse = ContractJsonResponse<typeof getEnrichmentDetailContract>

export const deleteTableRowsContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/table/[tableId]/rows',
  params: tableIdParamsSchema,
  body: deleteTableRowsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        message: z.string(),
        deletedCount: z.number(),
        deletedRowIds: z.array(z.string()),
        requestedCount: z.number().optional(),
        missingRowIds: z.array(z.string()).optional(),
      })
    ),
  },
})

/**
 * Kickoff body for an asynchronous "select all" delete. Sends the active filter (and an optional
 * exclusion set for "select all then deselect a few") instead of every row id, so the background
 * worker deletes in paginated batches. Omitting `filter` deletes the whole table (at the cutoff).
 */
export const deleteTableRowsAsyncBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  filter: bulkFilterSchema.optional(),
  excludeRowIds: z
    .array(z.string().min(1))
    .max(
      TABLE_LIMITS.MAX_EXCLUDE_ROW_IDS,
      `Cannot exclude more than ${TABLE_LIMITS.MAX_EXCLUDE_ROW_IDS} rows`
    )
    .optional(),
  /** Display-only doomed-row estimate (the filtered total minus deselections the client just
   *  showed). Persisted on the job so list/detail counts can subtract the not-yet-deleted
   *  remainder mid-job; clamped server-side, never used to scope the delete itself. */
  estimatedCount: z.number().int().min(0).optional(),
})

export type DeleteTableRowsAsyncBody = z.input<typeof deleteTableRowsAsyncBodySchema>

export const deleteTableRowsAsyncContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/delete-async',
  params: tableIdParamsSchema,
  body: deleteTableRowsAsyncBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ tableId: z.string(), jobId: z.string() })),
  },
})

// Workflow group contracts (`/api/table/[tableId]/groups`, `/cancel-runs`,
// `/columns/run`, `/rows/run`, `/rows/[rowId]/cells/[groupId]/run`)

const workflowGroupOutputSchema = z.object({
  // Workflow outputs carry blockId/path; enrichment outputs carry outputId and
  // leave these empty. `.default('')` keeps the parsed value a plain string.
  blockId: z.string().default('').describe('Workflow block producing this output.'),
  path: z.string().default('').describe('Path to the value in the workflow block output.'),
  outputId: z.string().optional().describe('Registry enrichment output identifier.'),
  columnName: z.string().min(1).describe('Table column receiving the output.'),
})

const workflowGroupDependenciesSchema = z.object({
  columns: z.array(z.string()).optional().describe('Columns required as producer inputs.'),
})

const workflowGroupTypeSchema = z.enum(['manual', 'enrichment'])

/** Which workflow state a group's per-cell runs execute against: `'live'` (the
 *  editable draft) or `'deployed'` (the latest active deployment). Defaults to
 *  `'live'` when omitted. */
const workflowGroupDeploymentModeSchema = z.enum(['live', 'deployed'])

/** One workflow Start-block input field ← one table column. */
const workflowGroupInputMappingSchema = z.object({
  inputName: z.string().min(1, 'inputName cannot be empty').describe('Workflow input name.'),
  columnName: z.string().min(1, 'columnName cannot be empty').describe('Source table column name.'),
})

export const workflowGroupOutputColumnSchema = z.object({
  name: z.string().min(1).describe('Output column name.'),
  type: columnTypeSchema.describe('Output column data type.'),
  required: z.boolean().optional().describe('Whether the output column is required.'),
  unique: z.boolean().optional().describe('Whether the output column must be unique.'),
  workflowGroupId: z.string().min(1).describe('Workflow group that populates the column.'),
})

export const groupIdParamsSchema = tableIdParamsSchema.extend({
  groupId: z.string().min(1),
})

export const addWorkflowGroupBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  group: z
    .object({
      id: z.string().min(1).describe('Optional client-provided workflow-group identifier.'),
      /** Workflow id for manual groups; `''` (or omitted) for enrichment groups. */
      workflowId: z
        .string()
        .default('')
        .describe('Backing workflow identifier for a manual group.'),
      /** Registry enrichment id for enrichment groups. */
      enrichmentId: z.string().min(1).optional().describe('Registry enrichment identifier.'),
      name: z.string().optional().describe('Workflow-group display name.'),
      /** Provenance of the group; defaults to `'manual'` when omitted. */
      type: workflowGroupTypeSchema.optional().describe('Workflow-group producer type.'),
      dependencies: workflowGroupDependenciesSchema
        .optional()
        .describe('Producer input dependencies.'),
      outputs: z
        .array(workflowGroupOutputSchema)
        .min(1)
        .describe('Producer outputs mapped to columns.'),
      /** Maps the workflow's Start-block inputs to table columns. */
      inputMappings: z
        .array(workflowGroupInputMappingSchema)
        .optional()
        .describe('Workflow inputs mapped from table columns.'),
      /** Which workflow state per-cell runs execute against. Defaults to `'live'`. */
      deploymentMode: workflowGroupDeploymentModeSchema
        .optional()
        .describe('Workflow state used for cell runs.'),
      /** When `false`, the group never auto-fires from the scheduler — it can
       *  only be triggered manually. Defaults to `true`. Persisted on the
       *  group; distinct from the top-level `autoRun` below which is a
       *  one-shot "schedule existing rows on creation" flag. */
      autoRun: z
        .boolean()
        .optional()
        .describe('Whether this group automatically runs for new rows.'),
    })
    .describe('Workflow or enrichment producer definition.'),
  outputColumns: z
    .array(workflowGroupOutputColumnSchema)
    .min(1)
    .describe('Columns created for producer outputs.'),
  /** When false, skip auto-scheduling existing rows after the group is added.
   *  Defaults to true so UI adds populate cells immediately; the Mothership
   *  tool sends `false` so the AI can stage groups without firing runs. */
  autoRun: z
    .boolean()
    .optional()
    .describe('Whether to schedule existing rows after group creation.'),
})

/**
 * Re-points an existing column to a different workflow output. Use when the
 * user changes which `(blockId, path)` flows into a column they already have,
 * without restructuring the rest of the group's outputs. Distinct from the
 * `outputs` add/remove diff: the column keeps its identity, type, deps, and
 * row position; only its source mapping changes. Existing row values for the
 * column are backfilled from saved execution logs at the new `(blockId, path)`
 * — rows whose log has no value for the new mapping end up empty.
 */
const workflowGroupMappingUpdateSchema = z.object({
  columnName: z.string().min(1).describe('Existing output column to remap.'),
  blockId: z.string().min(1).describe('New workflow block producing the value.'),
  path: z.string().min(1).describe('New path to the workflow output value.'),
})

export const updateWorkflowGroupBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  groupId: z.string().min(1).describe('Workflow group to update.'),
  workflowId: z.string().min(1).optional().describe('Replacement backing workflow identifier.'),
  name: z.string().optional().describe('Replacement workflow-group display name.'),
  dependencies: workflowGroupDependenciesSchema
    .optional()
    .describe('Replacement input dependencies.'),
  outputs: z.array(workflowGroupOutputSchema).optional().describe('Replacement producer outputs.'),
  newOutputColumns: z
    .array(workflowGroupOutputColumnSchema)
    .optional()
    .describe('Columns to add for new outputs.'),
  /**
   * Per-column mapping swaps: keep the column, change the source `(blockId,
   * path)`. Applied before the `outputs` add/remove diff. Each entry's
   * `columnName` must already exist in the group's outputs.
   */
  mappingUpdates: z
    .array(workflowGroupMappingUpdateSchema)
    .optional()
    .describe('Existing output-column mapping changes.'),
  /** Replace the group's input mappings. Omit to leave unchanged. */
  inputMappings: z
    .array(workflowGroupInputMappingSchema)
    .optional()
    .describe('Replacement workflow input mappings.'),
  /** Change which workflow state the group runs against. Omit to leave unchanged. */
  deploymentMode: workflowGroupDeploymentModeSchema
    .optional()
    .describe('Replacement workflow execution mode.'),
  /**
   * Echo of the group's provenance. A producer is fixed at creation: this body
   * has no `enrichmentId` field, so it can never supply the coordinate a new
   * type would need. A `type` that differs from the stored one is a 400.
   */
  type: workflowGroupTypeSchema
    .optional()
    .describe(
      "Workflow-group producer type. Must match the group's stored type — a group's producer cannot be changed after creation."
    ),
  /** Toggle the group's persisted auto-run flag. Omit to leave unchanged. */
  autoRun: z.boolean().optional().describe('Replacement automatic-run setting.'),
})

export const deleteWorkflowGroupBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  groupId: z.string().min(1).describe('Workflow group to delete.'),
})

const workflowGroupColumnsResponseSchema = successResponseSchema(
  z.object({
    columns: z.array(z.unknown()),
    workflowGroups: z.array(z.unknown()),
  })
)

export const addWorkflowGroupContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/groups',
  params: tableIdParamsSchema,
  body: addWorkflowGroupBodySchema,
  response: {
    mode: 'json',
    schema: workflowGroupColumnsResponseSchema,
  },
})

export const updateWorkflowGroupContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/table/[tableId]/groups',
  params: tableIdParamsSchema,
  body: updateWorkflowGroupBodySchema,
  response: {
    mode: 'json',
    schema: workflowGroupColumnsResponseSchema,
  },
})

export const deleteWorkflowGroupContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/table/[tableId]/groups',
  params: tableIdParamsSchema,
  body: deleteWorkflowGroupBodySchema,
  response: {
    mode: 'json',
    schema: workflowGroupColumnsResponseSchema,
  },
})

/**
 * Cancel scopes:
 *  - `all`     — every running/pending cell in the table; with `filter`, only
 *                cells on rows matching it (filtered "select all" Stop)
 *  - `row`     — every running/pending cell for a specific row (`rowId` required)
 */
/**
 * Plain-object base for the cancel-runs body. Kept un-refined so callers (e.g.
 * the v2 public contract, which narrows `filter` to the predicate grammar) can
 * `.extend()` before applying {@link refineCancelTableRunsScope} — Zod forbids
 * `.extend()` on a refined schema.
 */
export const cancelTableRunsBodyBaseSchema = z.object({
  workspaceId: workspaceIdSchema,
  scope: z.enum(['all', 'row']).describe('Whether to cancel across the table or one row.'),
  rowId: z.string().min(1).optional().describe('Row whose runs should be canceled for row scope.'),
  filter: z.union([predicateSchema, domainObjectSchema<Filter>()]).optional(),
  /** Scope-`all` only: rows deselected from the selection — their cells keep running. */
  excludeRowIds: z
    .array(z.string().min(1))
    .max(
      TABLE_LIMITS.MAX_EXCLUDE_ROW_IDS,
      `Cannot exclude more than ${TABLE_LIMITS.MAX_EXCLUDE_ROW_IDS} rows`
    )
    .optional()
    .describe('Rows excluded from an all-scope cancellation.'),
})

/**
 * `row` scope names exactly one row, so it requires `rowId` and rejects the
 * two select-all-only narrowing fields rather than ignoring them — a caller
 * that sends both has misunderstood the scope.
 */
export function refineCancelTableRunsScope(value: {
  scope: 'all' | 'row'
  rowId?: string
  filter?: unknown
  excludeRowIds?: string[]
}): { path: string[]; message: string }[] {
  if (value.scope !== 'row') return []
  const issues: { path: string[]; message: string }[] = []
  if (!value.rowId) {
    issues.push({ path: ['rowId'], message: 'rowId is required when scope is "row"' })
  }
  if (value.filter) {
    issues.push({ path: ['filter'], message: 'filter only applies to scope "all"' })
  }
  if (value.excludeRowIds) {
    issues.push({
      path: ['excludeRowIds'],
      message: 'excludeRowIds only applies to scope "all"',
    })
  }
  return issues
}

export const cancelTableRunsBodySchema = cancelTableRunsBodyBaseSchema.superRefine((value, ctx) => {
  for (const issue of refineCancelTableRunsScope(value)) {
    ctx.addIssue({ code: 'custom', ...issue })
  }
})

export const cancelTableRunsContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/cancel-runs',
  params: tableIdParamsSchema,
  body: cancelTableRunsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ cancelled: z.number() })),
  },
})

export const cancelTableJobBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  jobId: requiredFieldSchema('Job ID is required'),
})

/**
 * Run modes for `POST /api/table/[tableId]/columns/run`:
 *  - `all`        — every dep-satisfied row not already running/pending
 *  - `incomplete` — same, but additionally restricted to rows whose group has
 *    never run, or whose last run ended in `failed`/`aborted`
 *
 * Field is named `runMode` (not `mode`) to disambiguate from the table-import
 * `mode` arg (`append` / `replace`) which lives on a different op.
 */
/**
 * Run a set of workflow groups across the table or a row subset. The single
 * canonical user-driven run op — every UI gesture (single cell, per-row Play,
 * action-bar Play/Refresh, column-header menu) reduces to a `groupIds` +
 * optional `rowIds` shape. AI uses the `run_column` tool op.
 */
/**
 * Optional cap on how much work the dispatch does before completing. The
 * discriminated `type` keeps it extensible — only `'rows'` exists today
 * (`max` = number of eligible rows to run before stopping), but future kinds
 * (`'cells'`, `'cost'`, …) can extend the union without reshaping the request.
 */
export const runLimitSchema = z.object({
  type: z.literal('rows').describe('Unit constrained by the run cap.'),
  max: z
    .number()
    .int('max must be a whole number')
    .min(1, 'max must be at least 1')
    .max(1_000_000, 'max cannot exceed 1,000,000')
    .describe('Maximum eligible rows to run.'),
})

/**
 * Plain-object base for the run-column body. Kept un-refined so callers (e.g.
 * the v2 public contract, which narrows `filter` to the predicate grammar) can
 * `.extend()` before applying the mutex refines — Zod forbids `.extend()` on a
 * refined schema.
 */
export const runColumnBodyBaseSchema = z.object({
  workspaceId: workspaceIdSchema,
  groupIds: z.array(z.string().min(1)).min(1).describe('Workflow or enrichment groups to run.'),
  runMode: z
    .enum(['all', 'incomplete'])
    .default('all')
    .describe('Whether to run all or only incomplete cells.'),
  rowIds: z
    .array(z.string().min(1))
    .min(1)
    .max(MAX_RUN_TARGET_ROW_IDS, `Cannot target more than ${MAX_RUN_TARGET_ROW_IDS} rows`)
    .optional()
    .describe('Explicit row subset to run.'),
  /** "Select all under a filter" — run every row matching this filter instead of `rowIds`. The
   *  dispatcher walks only matching rows (paginated), so no id list is materialized. */
  filter: bulkFilterSchema.optional(),
  /** Select-all scope only: rows deselected from the selection — the dispatcher skips them. */
  excludeRowIds: z
    .array(z.string().min(1))
    .max(
      TABLE_LIMITS.MAX_EXCLUDE_ROW_IDS,
      `Cannot exclude more than ${TABLE_LIMITS.MAX_EXCLUDE_ROW_IDS} rows`
    )
    .optional()
    .describe('Rows excluded from a select-all run scope.'),
  /** Cap the run to the first `max` eligible rows. Omit for an unbounded run. */
  limit: runLimitSchema.optional().describe('Optional cap on eligible rows to run.'),
})

/** An explicit row set and a select-all filter are mutually exclusive scopes. */
export const runColumnScopeMutexRefine = [
  (data: { rowIds?: string[]; filter?: unknown }) => !(data.rowIds && data.filter),
  { message: 'Provide either filter or rowIds, but not both' },
] as const

/** Deselections only mean something under select-all scope. */
export const runColumnExcludeMutexRefine = [
  (data: { rowIds?: string[]; excludeRowIds?: string[] }) => !(data.rowIds && data.excludeRowIds),
  { message: 'excludeRowIds only applies to select-all scope (no rowIds)' },
] as const

export const runColumnBodySchema = runColumnBodyBaseSchema
  .refine(...runColumnScopeMutexRefine)
  .refine(...runColumnExcludeMutexRefine)

export const runColumnContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/columns/run',
  params: tableIdParamsSchema,
  body: runColumnBodySchema,
  response: {
    mode: 'json',
    /**
     * `dispatchId` is the id of the `table_run_dispatches` row created for
     * this run. The dispatcher task picks it up and crawls the table row by
     * row; clients receive cell + dispatch events via SSE. Null when
     * trigger.dev is disabled — in that mode cells run inline in-process and
     * no dispatch row is created.
     */
    schema: successResponseSchema(z.object({ dispatchId: z.string().min(1).nullable() })),
  },
})

export type AddWorkflowGroupBodyInput = z.input<typeof addWorkflowGroupBodySchema>
export type UpdateWorkflowGroupBodyInput = z.input<typeof updateWorkflowGroupBodySchema>
export type DeleteWorkflowGroupBodyInput = z.input<typeof deleteWorkflowGroupBodySchema>
export type CancelTableRunsBodyInput = z.input<typeof cancelTableRunsBodySchema>
export type RunColumnBodyInput = z.input<typeof runColumnBodySchema>
/** Shared `runMode` union — used by every UI / hook / Mothership site that
 *  builds a run-column payload. Single source of truth for the literal pair. */
export type RunMode = NonNullable<RunColumnBodyInput['runMode']>
/** Run cap shape consumed by hooks/components building a capped run payload. */
export type RunLimit = z.input<typeof runLimitSchema>

/**
 * Active dispatch overlay: rows in the scope ahead of `cursor` render as
 * `pending` on refresh, so a long Run-all doesn't lose its queued indicators.
 * Returned by `GET /api/table/[tableId]/dispatches`; mirrored client-side via
 * `kind: 'dispatch'` SSE events.
 */
export const activeDispatchSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'dispatching']),
  mode: z.enum(['all', 'incomplete', 'new']),
  isManualRun: z.boolean(),
  cursor: z.number().int(),
  scope: z.object({
    groupIds: z.array(z.string()),
    rowIds: z.array(z.string()).optional(),
  }),
  /** Present when the run is capped. The client's "about to run" overlay skips
   *  capped dispatches — it can't tell which rows ahead of the cursor fall
   *  within the budget, so it would over-render Queued; the dispatcher's real
   *  per-row pending stamps cover the actual rows instead. */
  limit: runLimitSchema.optional(),
})

export const listActiveDispatchesContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/[tableId]/dispatches',
  params: tableIdParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        dispatches: z.array(activeDispatchSchema),
        /** Map rowId → number of in-flight (queued/running/pending) cells on
         *  that row. Sums to the "X running" badge and drives the per-row
         *  gutter Run/Stop button. Server-authoritative: refetched on a
         *  throttle as cell SSE events arrive, plus optimistic stamps on
         *  run-click. */
        runningByRowId: z.record(z.string(), z.number().int().positive()),
        /** Whether any in-flight cell is actually claimed by a worker
         *  (`status === 'running'`) — table-wide, unlike the client's
         *  loaded-rows view. Drives the header's "Queueing" vs "N running"
         *  label once the run's active window scrolls past the loaded rows. */
        hasRunning: z.boolean(),
      })
    ),
  },
})

export type ActiveDispatch = z.output<typeof activeDispatchSchema>

export const tableEventStreamQuerySchema = z.object({
  /** Replay cursor: events with `eventId > from` are replayed on connect.
   *  `0` replays the whole buffer (prune recovery). Absent → the server tails
   *  from the latest event id — a fresh mount has just fetched current state
   *  from the DB, so replaying history would only rewind it. */
  from: z.preprocess((value) => {
    if (typeof value !== 'string') return undefined
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
  }, z.number().int().min(0).optional()),
})

export const tableEventStreamContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/[tableId]/events/stream',
  params: tableIdParamsSchema,
  query: tableEventStreamQuerySchema,
  response: {
    mode: 'stream',
  },
})

/**
 * A saved view's stored shape: `TableMetadata`'s column layout plus the row
 * predicate and sort.
 *
 * Every column reference is STORED as a stable column id, so a rename never
 * invalidates a view — but a write may reference a column either way, and
 * `normalizeViewConfigForStorage` resolves a name to its id before the config is
 * persisted. That is what lets the name-keyed v2 surface and the id-keyed
 * first-party UI write the same blob. A read is presented in the reading
 * surface's own vocabulary.
 */
export const tableViewConfigSchema = tableMetadataSchema
  .extend({
    columnWidths: z
      .record(z.string(), z.number().positive())
      .optional()
      .describe('Column widths keyed by column name or stable column identifier.'),
    columnOrder: z
      .array(z.string())
      .optional()
      .describe('Columns in display order, by name or stable identifier.'),
    pinnedColumns: z
      .array(z.string())
      .optional()
      .describe('Pinned columns, by name or stable identifier.'),
    hiddenColumns: z
      .array(z.string())
      .optional()
      .describe('Hidden columns, by name or stable identifier.'),
    // The v2 predicate/sort grammar — same wire as the query routes, so a saved
    // view gets the same strictness and depth bounds as a live filter, and its
    // config can later feed the v2 surfaces without conversion.
    filter: predicateInputSchema
      .nullable()
      .optional()
      .describe('Saved row predicate, or null when the view is unfiltered.'),
    sort: sortSpecSchema
      .nullable()
      .optional()
      .describe('Saved ordered sort specification, or null for default ordering.'),
  })
  /**
   * `tableMetadataSchema` is not strict — it is also the body and the response
   * of the column-layout endpoint, which has its own compatibility story — so
   * extending it inherited the laxness and let a misspelled layout key be
   * accepted and dropped. Strictness is applied here, where the schema is a
   * saved-view config. Safe in both directions because
   * `normalizeStoredViewConfig` projects a stored blob onto exactly these keys
   * before a read is validated against this schema.
   */
  .strict() satisfies z.ZodType<TableViewConfig>

export const tableViewSchema = z.object({
  id: z.string(),
  tableId: z.string(),
  name: z.string(),
  config: tableViewConfigSchema,
  isDefault: z.boolean(),
  createdBy: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

/** Free-form display label — no character set or length restriction, unlike the
 *  identifier-shaped table/column names. Only emptiness is rejected, since a
 *  blank name renders as an unselectable gap in the views dropdown. */
const viewNameSchema = z.string().trim().min(1, 'View name is required')

export const tableViewParamsSchema = tableIdParamsSchema.extend({
  viewId: z.string().min(1).describe('Unique saved-view identifier.'),
})

export const listTableViewsQuerySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
})

export const listTableViewsContract = defineRouteContract({
  method: 'GET',
  path: '/api/table/[tableId]/views',
  params: tableIdParamsSchema,
  query: listTableViewsQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ views: z.array(tableViewSchema) })),
  },
})

export const createTableViewBodySchema = z.object({
  workspaceId: z
    .string()
    .min(1, 'Workspace ID is required')
    .describe('Workspace that owns the table.'),
  name: viewNameSchema.describe('Saved-view display name.'),
  config: tableViewConfigSchema.describe('Saved filter, sort, and column-layout configuration.'),
})

export const createTableViewContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/[tableId]/views',
  params: tableIdParamsSchema,
  body: createTableViewBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ view: tableViewSchema })),
  },
})

/**
 * Every field is optional so the three call sites — overwrite a view's config,
 * rename it, promote it to default — share one endpoint and send only what they
 * change. `isDefault: true` demotes the table's existing default server-side.
 */
export const updateTableViewBodySchema = z
  .object({
    workspaceId: z
      .string()
      .min(1, 'Workspace ID is required')
      .describe('Workspace that owns the table.'),
    name: viewNameSchema.optional().describe('Replacement saved-view display name.'),
    /** Full replacement for callers that own the complete configuration snapshot. */
    config: tableViewConfigSchema
      .optional()
      .describe('Complete replacement saved-view configuration.'),
    /**
     * Shallow-merged into the stored config server-side (jsonb `||`), so concurrent
     * partial writes can't clobber each other from a stale client snapshot. Use for
     * the grid's incremental layout saves.
     */
    configPatch: tableViewConfigSchema
      .optional()
      .describe('Saved-view configuration fields to shallow-merge.'),
    isDefault: z
      .boolean()
      .optional()
      .describe('Whether to promote this view to the table default.'),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.config !== undefined ||
      value.configPatch !== undefined ||
      value.isDefault !== undefined,
    { message: 'Provide at least one of name, config, configPatch, or isDefault' }
  )
  .refine((value) => !(value.config !== undefined && value.configPatch !== undefined), {
    message: 'config and configPatch are mutually exclusive',
  })

export const updateTableViewContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/table/[tableId]/views/[viewId]',
  params: tableViewParamsSchema,
  body: updateTableViewBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ view: tableViewSchema })),
  },
})

export const deleteTableViewBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
})

export const deleteTableViewContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/table/[tableId]/views/[viewId]',
  params: tableViewParamsSchema,
  body: deleteTableViewBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ deleted: z.literal(true) })),
  },
})

export type TableViewWire = z.output<typeof tableViewSchema>
export type TableViewConfigInput = z.input<typeof tableViewConfigSchema>
export type CreateTableViewBody = z.input<typeof createTableViewBodySchema>
export type UpdateTableViewBody = z.input<typeof updateTableViewBodySchema>

const bulkTableIdListSchema = z
  .array(requiredFieldSchema('id entries cannot be empty'))
  .max(MAX_TABLE_BATCH_ITEMS, `cannot contain more than ${MAX_TABLE_BATCH_ITEMS} ids`)
  .default([])

/**
 * Bounds a mixed selection from the Tables list, which interleaves folder rows
 * and table rows in one grid. Both lists travel in one request so a mixed
 * selection commits as one authorized operation instead of a client-sequenced
 * fan-out.
 *
 * The cap is on the combined count: each list is individually bounded first so
 * a 10,000-entry array is rejected before the combined arithmetic, and folders
 * cost more than tables because they cascade.
 */
function refineBoundedTableSelection(
  selection: { tableIds: string[]; folderIds: string[] },
  ctx: z.RefinementCtx
): void {
  const total = selection.tableIds.length + selection.folderIds.length
  if (total === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['tableIds'],
      message: 'At least one table or folder must be selected',
    })
    return
  }
  if (total > MAX_TABLE_BATCH_ITEMS) {
    ctx.addIssue({
      code: 'custom',
      path: ['tableIds'],
      message: `tableIds and folderIds cannot contain more than ${MAX_TABLE_BATCH_ITEMS} ids combined`,
    })
  }
}

export const bulkMoveTablesBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns every selected item.'),
    tableIds: bulkTableIdListSchema.describe('Tables to move, by identifier.'),
    folderIds: bulkTableIdListSchema.describe('Table folders to re-parent, by identifier.'),
    targetFolderId: folderIdSchema
      .nullable()
      .describe('Destination folder in the table folder tree. `null` is the workspace root.'),
  })
  .superRefine(refineBoundedTableSelection)
export type BulkMoveTablesBody = z.input<typeof bulkMoveTablesBodySchema>

export const bulkDeleteTablesBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns every selected item.'),
    tableIds: bulkTableIdListSchema.describe('Tables to archive, by identifier.'),
    folderIds: bulkTableIdListSchema.describe(
      'Table folders to delete, by identifier. Each cascades to everything inside it.'
    ),
  })
  .superRefine(refineBoundedTableSelection)
export type BulkDeleteTablesBody = z.input<typeof bulkDeleteTablesBodySchema>

const bulkTableItemKindSchema = z.enum(['table', 'folder'])

const bulkTableItemSchema = z.object({
  kind: bulkTableItemKindSchema,
  id: z.string(),
  name: z.string(),
})

/** An id nothing active resolved to. Carries no name, because nothing was found to name. */
const bulkTableMissingSchema = z.object({ kind: bulkTableItemKindSchema, id: z.string() })

/**
 * An item the batch reached but could not act on for a reason the caller can
 * act on in turn — a delete lock, a folder cycle. Distinct from `notFound`,
 * which also absorbs the items the caller may not write to.
 */
const bulkTableFailureSchema = bulkTableItemSchema.extend({ reason: z.string() })

/**
 * Items dropped because a selected folder already carries them: a table filed
 * inside a selected folder, or a subfolder of another selected folder.
 */
const bulkTableSkippedSchema = z.array(bulkTableItemSchema)

export const bulkMoveTablesContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/bulk-move',
  body: bulkMoveTablesBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        moved: z.array(bulkTableItemSchema),
        skipped: bulkTableSkippedSchema,
        notFound: z.array(bulkTableMissingSchema),
        failed: z.array(bulkTableFailureSchema),
      })
    ),
  },
})
export const bulkDeleteTablesContract = defineRouteContract({
  method: 'POST',
  path: '/api/table/bulk-delete',
  body: bulkDeleteTablesBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        deleted: z.array(bulkTableItemSchema),
        skipped: bulkTableSkippedSchema,
        notFound: z.array(bulkTableMissingSchema),
        failed: z.array(bulkTableFailureSchema),
        /** Totals across the explicit archives and every folder cascade they triggered. */
        deletedItems: z.object({
          tables: z.number().int(),
          folders: z.number().int(),
        }),
      })
    ),
  },
})
