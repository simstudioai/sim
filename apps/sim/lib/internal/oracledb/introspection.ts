import { executeOracleStatements } from '@/lib/internal/oracledb/client'
import type { OracleConnectionInput, OracleIntrospectInput } from '@/lib/internal/oracledb/schema'
import type {
  OracleWorkerStatement,
  OracleWorkerStatementResult,
} from '@/lib/internal/oracledb/worker-protocol'

const MAX_INTROSPECTION_TABLES = 1_000
const MAX_INTROSPECTION_COLUMNS = 10_000
const MAX_INTROSPECTION_BYTES = 10 * 1024 * 1024
const INTROSPECTION_ENVELOPE_RESERVE_BYTES = 16 * 1024
const TARGET_SCHEMA_SQL = `COALESCE(:schemaName, SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA'))`

export interface OracleIntrospectionResult {
  tables: Array<{
    name: string
    schema: string
    columns: Array<{
      name: string
      type: string
      nullable: boolean
      default: string | null
      isPrimaryKey: boolean
      isForeignKey: boolean
      references?: {
        schema: string
        table: string
        column: string
      }
    }>
    primaryKey: string[]
    foreignKeys: Array<{
      column: string
      referencesSchema: string
      referencesTable: string
      referencesColumn: string
    }>
    indexes: Array<{
      name: string
      columns: string[]
      unique: boolean
    }>
  }>
  schemas: string[]
  schema: string
  truncated: boolean
}

const INTROSPECTION_SQL = {
  currentSchema: `SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS "SCHEMA_NAME" FROM DUAL`,
  schemas: `SELECT DISTINCT OWNER AS "SCHEMA_NAME"
    FROM ALL_TABLES
    ORDER BY OWNER
    FETCH FIRST 1001 ROWS ONLY`,
  tables: `SELECT OWNER AS "TABLE_SCHEMA", TABLE_NAME AS "TABLE_NAME"
    FROM ALL_TABLES
    WHERE OWNER = ${TARGET_SCHEMA_SQL}
      AND NESTED = 'NO'
      AND SECONDARY = 'N'
    ORDER BY TABLE_NAME
    FETCH FIRST 1001 ROWS ONLY`,
  columns: `SELECT cols.OWNER AS "TABLE_SCHEMA", cols.TABLE_NAME AS "TABLE_NAME",
      cols.COLUMN_NAME AS "COLUMN_NAME", cols.DATA_TYPE AS "DATA_TYPE",
      cols.DATA_LENGTH AS "DATA_LENGTH", cols.CHAR_LENGTH AS "CHAR_LENGTH",
      cols.CHAR_USED AS "CHAR_USED", cols.DATA_PRECISION AS "DATA_PRECISION",
      cols.DATA_SCALE AS "DATA_SCALE", cols.NULLABLE AS "NULLABLE",
      CAST(NULL AS VARCHAR2(1)) AS "DATA_DEFAULT"
    FROM ALL_TAB_COLUMNS cols
    JOIN ALL_TABLES tables
      ON tables.OWNER = cols.OWNER AND tables.TABLE_NAME = cols.TABLE_NAME
      AND tables.NESTED = 'NO' AND tables.SECONDARY = 'N'
    WHERE cols.OWNER = ${TARGET_SCHEMA_SQL}
    ORDER BY cols.TABLE_NAME, cols.COLUMN_ID
    FETCH FIRST 10001 ROWS ONLY`,
  primaryKeys: `SELECT c.OWNER AS "TABLE_SCHEMA", c.TABLE_NAME AS "TABLE_NAME",
      cc.COLUMN_NAME AS "COLUMN_NAME"
    FROM ALL_CONSTRAINTS c
    JOIN ALL_CONS_COLUMNS cc
      ON cc.OWNER = c.OWNER AND cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME
    WHERE c.OWNER = ${TARGET_SCHEMA_SQL}
      AND c.CONSTRAINT_TYPE = 'P'
      AND EXISTS (
        SELECT 1 FROM ALL_TABLES tables
        WHERE tables.OWNER = c.OWNER AND tables.TABLE_NAME = c.TABLE_NAME
          AND tables.NESTED = 'NO' AND tables.SECONDARY = 'N'
      )
    ORDER BY c.TABLE_NAME, c.CONSTRAINT_NAME, cc.POSITION
    FETCH FIRST 10001 ROWS ONLY`,
  foreignKeys: `SELECT c.OWNER AS "TABLE_SCHEMA", c.TABLE_NAME AS "TABLE_NAME",
      child_cols.COLUMN_NAME AS "COLUMN_NAME",
      parent.OWNER AS "REFERENCED_SCHEMA", parent.TABLE_NAME AS "REFERENCED_TABLE",
      parent_cols.COLUMN_NAME AS "REFERENCED_COLUMN"
    FROM ALL_CONSTRAINTS c
    JOIN ALL_CONS_COLUMNS child_cols
      ON child_cols.OWNER = c.OWNER AND child_cols.CONSTRAINT_NAME = c.CONSTRAINT_NAME
    JOIN ALL_CONSTRAINTS parent
      ON parent.OWNER = c.R_OWNER AND parent.CONSTRAINT_NAME = c.R_CONSTRAINT_NAME
    JOIN ALL_CONS_COLUMNS parent_cols
      ON parent_cols.OWNER = parent.OWNER
      AND parent_cols.CONSTRAINT_NAME = parent.CONSTRAINT_NAME
      AND parent_cols.POSITION = child_cols.POSITION
    WHERE c.OWNER = ${TARGET_SCHEMA_SQL}
      AND c.CONSTRAINT_TYPE = 'R'
      AND EXISTS (
        SELECT 1 FROM ALL_TABLES tables
        WHERE tables.OWNER = c.OWNER AND tables.TABLE_NAME = c.TABLE_NAME
          AND tables.NESTED = 'NO' AND tables.SECONDARY = 'N'
      )
    ORDER BY c.TABLE_NAME, c.CONSTRAINT_NAME, child_cols.POSITION
    FETCH FIRST 10001 ROWS ONLY`,
  indexes: `SELECT i.TABLE_OWNER AS "TABLE_SCHEMA", i.TABLE_NAME AS "TABLE_NAME",
      i.INDEX_NAME AS "INDEX_NAME", i.UNIQUENESS AS "UNIQUENESS",
      ic.COLUMN_NAME AS "COLUMN_NAME"
    FROM ALL_INDEXES i
    JOIN ALL_IND_COLUMNS ic
      ON ic.INDEX_OWNER = i.OWNER AND ic.INDEX_NAME = i.INDEX_NAME
    WHERE i.TABLE_OWNER = ${TARGET_SCHEMA_SQL}
      AND EXISTS (
        SELECT 1 FROM ALL_TABLES tables
        WHERE tables.OWNER = i.TABLE_OWNER AND tables.TABLE_NAME = i.TABLE_NAME
          AND tables.NESTED = 'NO' AND tables.SECONDARY = 'N'
      )
      AND NOT EXISTS (
        SELECT 1 FROM ALL_CONSTRAINTS c
        WHERE c.OWNER = i.TABLE_OWNER
          AND c.TABLE_NAME = i.TABLE_NAME
          AND c.INDEX_NAME = i.INDEX_NAME
          AND c.CONSTRAINT_TYPE = 'P'
      )
    ORDER BY i.TABLE_NAME, i.INDEX_NAME, ic.COLUMN_POSITION
    FETCH FIRST 10001 ROWS ONLY`,
} as const

function stringField(row: Record<string, unknown>, field: string): string {
  const value = row[field]
  if (typeof value !== 'string') throw new Error(`Oracle introspection omitted ${field}`)
  return value
}

function nullableString(row: Record<string, unknown>, field: string): string | null {
  const value = row[field]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`Oracle introspection returned invalid ${field}`)
  return value
}

function optionalInteger(row: Record<string, unknown>, field: string): number | null {
  const value = row[field]
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`Oracle introspection returned invalid ${field}`)
  return parsed
}

function formatOracleType(row: Record<string, unknown>): string {
  const dataType = stringField(row, 'DATA_TYPE')
  const dataLength = optionalInteger(row, 'DATA_LENGTH')
  const charLength = optionalInteger(row, 'CHAR_LENGTH')
  const precision = optionalInteger(row, 'DATA_PRECISION')
  const scale = optionalInteger(row, 'DATA_SCALE')
  const charUsed = nullableString(row, 'CHAR_USED')

  if (dataType === 'NUMBER' && (precision !== null || scale !== null)) {
    return `NUMBER(${precision === null ? '*' : precision}${scale === null ? '' : `,${scale}`})`
  }
  if (dataType === 'CHAR' || dataType === 'VARCHAR2') {
    const length = charUsed === 'C' ? charLength : dataLength
    return length === null
      ? dataType
      : `${dataType}(${length} ${charUsed === 'C' ? 'CHAR' : 'BYTE'})`
  }
  if (dataType === 'NCHAR' || dataType === 'NVARCHAR2') {
    return charLength === null ? dataType : `${dataType}(${charLength})`
  }
  if (dataType === 'RAW') return dataLength === null ? dataType : `RAW(${dataLength})`
  if (/^TIMESTAMP(?: WITH (?:LOCAL )?TIME ZONE)?$/.test(dataType) && scale !== null) {
    return dataType.replace('TIMESTAMP', `TIMESTAMP(${scale})`)
  }
  return dataType
}

function capFinalTables(
  tables: OracleIntrospectionResult['tables'],
  schemas: string[]
): { tables: OracleIntrospectionResult['tables']; truncated: boolean } {
  const schemasBytes = Buffer.byteLength(JSON.stringify(schemas), 'utf8')
  const limit = MAX_INTROSPECTION_BYTES - INTROSPECTION_ENVELOPE_RESERVE_BYTES - schemasBytes
  const kept: OracleIntrospectionResult['tables'] = []
  let bytes = 2

  for (const table of tables) {
    const tableBytes = Buffer.byteLength(JSON.stringify(table), 'utf8')
    if (bytes + tableBytes + 1 > limit) return { tables: kept, truncated: true }
    bytes += tableBytes + 1
    kept.push(table)
  }
  return { tables: kept, truncated: false }
}

function tableKey(schema: string, table: string): string {
  return `${schema}\0${table}`
}

function boundedSchemas(rows: OracleWorkerStatementResult['rows'], targetSchema: string): string[] {
  const visible = rows
    .slice(0, MAX_INTROSPECTION_TABLES)
    .map((row) => stringField(row, 'SCHEMA_NAME'))
  const sorted = Array.from(new Set([...visible, targetSchema])).sort((left, right) =>
    left.localeCompare(right)
  )
  if (sorted.length <= MAX_INTROSPECTION_TABLES) return sorted

  return [
    ...sorted.filter((schema) => schema !== targetSchema).slice(0, MAX_INTROSPECTION_TABLES - 1),
    targetSchema,
  ].sort((left, right) => left.localeCompare(right))
}

function introspectionStatements(schemaName: string | null): OracleWorkerStatement[] {
  const binds = { schemaName }
  return [
    { sql: INTROSPECTION_SQL.currentSchema, maxRows: 1 },
    { sql: INTROSPECTION_SQL.schemas, maxRows: MAX_INTROSPECTION_TABLES + 1 },
    {
      sql: INTROSPECTION_SQL.tables,
      binds,
      maxRows: MAX_INTROSPECTION_TABLES + 1,
    },
    {
      sql: INTROSPECTION_SQL.columns,
      binds,
      maxRows: MAX_INTROSPECTION_COLUMNS + 1,
    },
    {
      sql: INTROSPECTION_SQL.primaryKeys,
      binds,
      maxRows: MAX_INTROSPECTION_COLUMNS + 1,
    },
    {
      sql: INTROSPECTION_SQL.foreignKeys,
      binds,
      maxRows: MAX_INTROSPECTION_COLUMNS + 1,
    },
    {
      sql: INTROSPECTION_SQL.indexes,
      binds,
      maxRows: MAX_INTROSPECTION_COLUMNS + 1,
    },
  ]
}

function resultWasTruncated(result: OracleWorkerStatementResult): boolean {
  return result.truncated === true
}

/** Reads visible Oracle dictionary metadata in seven bounded, set-based queries. */
export async function executeOracleIntrospect(
  connection: OracleConnectionInput,
  input: Pick<OracleIntrospectInput, 'schema'>,
  signal?: AbortSignal
): Promise<OracleIntrospectionResult> {
  const results = await executeOracleStatements(
    connection,
    introspectionStatements(input.schema ?? null),
    { readOnlyTransaction: true },
    signal
  )
  const [
    currentResult,
    schemasResult,
    tablesResult,
    columnsResult,
    pkResult,
    fkResult,
    indexResult,
  ] = results
  const currentSchema = stringField(currentResult.rows[0] ?? {}, 'SCHEMA_NAME')
  const targetSchema = input.schema ?? currentSchema
  const tableRows = tablesResult.rows.slice(0, MAX_INTROSPECTION_TABLES)
  const tableMap = new Map<string, OracleIntrospectionResult['tables'][number]>()

  for (const row of tableRows) {
    const schema = stringField(row, 'TABLE_SCHEMA')
    const name = stringField(row, 'TABLE_NAME')
    tableMap.set(tableKey(schema, name), {
      name,
      schema,
      columns: [],
      primaryKey: [],
      foreignKeys: [],
      indexes: [],
    })
  }

  for (const row of columnsResult.rows.slice(0, MAX_INTROSPECTION_COLUMNS)) {
    const schema = stringField(row, 'TABLE_SCHEMA')
    const tableName = stringField(row, 'TABLE_NAME')
    const table = tableMap.get(tableKey(schema, tableName))
    if (!table) continue
    table.columns.push({
      name: stringField(row, 'COLUMN_NAME'),
      type: formatOracleType(row),
      nullable: stringField(row, 'NULLABLE') === 'Y',
      default: nullableString(row, 'DATA_DEFAULT'),
      isPrimaryKey: false,
      isForeignKey: false,
    })
  }

  for (const row of pkResult.rows.slice(0, MAX_INTROSPECTION_COLUMNS)) {
    const table = tableMap.get(
      tableKey(stringField(row, 'TABLE_SCHEMA'), stringField(row, 'TABLE_NAME'))
    )
    if (!table) continue
    const column = stringField(row, 'COLUMN_NAME')
    table.primaryKey.push(column)
    const columnInfo = table.columns.find((item) => item.name === column)
    if (columnInfo) columnInfo.isPrimaryKey = true
  }

  for (const row of fkResult.rows.slice(0, MAX_INTROSPECTION_COLUMNS)) {
    const table = tableMap.get(
      tableKey(stringField(row, 'TABLE_SCHEMA'), stringField(row, 'TABLE_NAME'))
    )
    if (!table) continue
    const foreignKey = {
      column: stringField(row, 'COLUMN_NAME'),
      referencesSchema: stringField(row, 'REFERENCED_SCHEMA'),
      referencesTable: stringField(row, 'REFERENCED_TABLE'),
      referencesColumn: stringField(row, 'REFERENCED_COLUMN'),
    }
    table.foreignKeys.push(foreignKey)
    const columnInfo = table.columns.find((item) => item.name === foreignKey.column)
    if (columnInfo) {
      columnInfo.isForeignKey = true
      columnInfo.references ??= {
        schema: foreignKey.referencesSchema,
        table: foreignKey.referencesTable,
        column: foreignKey.referencesColumn,
      }
    }
  }

  const indexesByTable = new Map<
    string,
    Map<string, { name: string; columns: string[]; unique: boolean }>
  >()
  for (const row of indexResult.rows.slice(0, MAX_INTROSPECTION_COLUMNS)) {
    const key = tableKey(stringField(row, 'TABLE_SCHEMA'), stringField(row, 'TABLE_NAME'))
    const table = tableMap.get(key)
    if (!table) continue
    let indexes = indexesByTable.get(key)
    if (!indexes) {
      indexes = new Map()
      indexesByTable.set(key, indexes)
    }
    const indexName = stringField(row, 'INDEX_NAME')
    let index = indexes.get(indexName)
    if (!index) {
      index = {
        name: indexName,
        columns: [],
        unique: stringField(row, 'UNIQUENESS') === 'UNIQUE',
      }
      indexes.set(indexName, index)
      table.indexes.push(index)
    }
    index.columns.push(stringField(row, 'COLUMN_NAME'))
  }

  const schemas = boundedSchemas(schemasResult.rows, targetSchema)

  const metadataTruncated =
    schemasResult.rows.length > MAX_INTROSPECTION_TABLES ||
    tablesResult.rows.length > MAX_INTROSPECTION_TABLES ||
    columnsResult.rows.length > MAX_INTROSPECTION_COLUMNS ||
    pkResult.rows.length > MAX_INTROSPECTION_COLUMNS ||
    fkResult.rows.length > MAX_INTROSPECTION_COLUMNS ||
    indexResult.rows.length > MAX_INTROSPECTION_COLUMNS ||
    results.some(resultWasTruncated)

  const finalTables = capFinalTables(Array.from(tableMap.values()), schemas)

  return {
    tables: finalTables.tables,
    schemas,
    schema: targetSchema,
    truncated: metadataTruncated || finalTables.truncated,
  }
}

export const oracleIntrospectionInternals = {
  INTROSPECTION_SQL,
  boundedSchemas,
  capFinalTables,
  formatOracleType,
  introspectionStatements,
}
