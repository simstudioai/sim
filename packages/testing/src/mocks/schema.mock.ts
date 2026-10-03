import {
  GENERATED_SCHEMA_CONSTANTS,
  GENERATED_SCHEMA_ENUMS,
  GENERATED_SCHEMA_TABLES,
} from './schema-tables.generated'

/**
 * Comprehensive mock for `@sim/db/schema`, derived from `packages/db/schema.ts`.
 *
 * `schema-tables.generated.ts` lists every table's column names, every enum's values and every
 * literal constant (`bun run scripts/generate-schema-mock.ts`; `check:schema-mock` fails on drift),
 * so a column added to the real schema is present here without a hand edit. Only names are copied —
 * no drizzle table object is imported at runtime.
 *
 * Every table maps each column to a `table.column` string, which satisfies the drizzle column
 * references used in query builders while keeping columns distinguishable ACROSS tables.
 *
 * The qualification is load-bearing, not cosmetic. When every column was its own
 * bare name, `knowledgeConnector.id`, `document.id` and `knowledgeConnectorSyncLog.id`
 * were all the string `'id'`, so any assertion of the form
 * `node.left === schemaMock.<table>.<column>` passed for the wrong table — and a
 * predicate guarding the wrong table's column was indistinguishable from the
 * right one. Rendered SQL cannot cover the gap either: `createMockSql` renders
 * every interpolation as `?`, so the bound `values` are the only place a
 * predicate's operands are observable at all.
 *
 * Enums mirror drizzle's `pgEnum` shape (`{ enumName, enumValues }`); `tsvector` / `bytea` are the
 * custom column-type names.
 */

type GeneratedTables = typeof GENERATED_SCHEMA_TABLES
type GeneratedEnums = typeof GENERATED_SCHEMA_ENUMS

/** A mocked table: every real column name mapped to its `table.column` string. */
export type MockSchemaTable<Columns extends readonly string[]> = {
  readonly [Column in Columns[number]]: string
}

type MockSchemaTables = {
  readonly [Table in keyof GeneratedTables]: MockSchemaTable<GeneratedTables[Table]>
}

type MockSchemaEnums = {
  readonly [Enum in keyof GeneratedEnums]: {
    readonly enumName: Enum
    readonly enumValues: GeneratedEnums[Enum]
  }
}

function buildTable(table: string, columns: readonly string[]): Record<string, string> {
  const mocked: Record<string, string> = {}
  for (const column of columns) mocked[column] = `${table}.${column}`
  return mocked
}

const tables: Record<string, Record<string, string>> = {}
for (const [table, columns] of Object.entries(GENERATED_SCHEMA_TABLES)) {
  tables[table] = buildTable(table, columns)
}

const enums: Record<string, { enumName: string; enumValues: readonly string[] }> = {}
for (const [name, values] of Object.entries(GENERATED_SCHEMA_ENUMS)) {
  enums[name] = { enumName: name, enumValues: values }
}

/**
 * Static mock module for `@sim/db/schema` (installed globally in `apps/sim/vitest.setup.ts`, and
 * re-exported by the global `@sim/db` mock like the real barrel). Table objects are stable per
 * test file, so `queueTableRows(schemaMock.member, rows)` routes by identity.
 *
 * @example
 * ```ts
 * vi.mock('@sim/db/schema', () => schemaMock)
 * ```
 */
export const schemaMock = {
  ...(tables as MockSchemaTables),
  ...(enums as MockSchemaEnums),
  ...GENERATED_SCHEMA_CONSTANTS,
  /**
   * The schema's folded-address expression. Returns the column it wraps so a
   * predicate built on it still names the column, and assertions on condition
   * shape keep working.
   */
  foldedEmail: (column: unknown) => column,
  /** Custom column type for tsvector. */
  tsvector: 'tsvector',
  /** Custom column type for bytea. */
  bytea: 'bytea',
}
