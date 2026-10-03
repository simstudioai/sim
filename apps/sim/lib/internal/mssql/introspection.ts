import type sql from 'mssql'
import { executeMssqlRequest } from '@/lib/internal/mssql/query'

export interface MSSQLIntrospectionResult {
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
}

interface SchemaRow {
  SCHEMA_NAME: string
}

interface TableRow {
  TABLE_NAME: string
  TABLE_SCHEMA: string
}

interface ColumnRow {
  TABLE_NAME: string
  COLUMN_NAME: string
  DATA_TYPE: string
  IS_NULLABLE: string
  COLUMN_DEFAULT: string | null
}

interface KeyColumnRow {
  TABLE_NAME: string
  COLUMN_NAME: string
}

interface ForeignKeyRow {
  TABLE_NAME: string
  COLUMN_NAME: string
  REFERENCED_TABLE_SCHEMA: string
  REFERENCED_TABLE_NAME: string
  REFERENCED_COLUMN_NAME: string
}

interface IndexRow {
  TABLE_NAME: string
  INDEX_NAME: string
  COLUMN_NAME: string
  IS_UNIQUE: boolean | number
}

/**
 * Reads table, column, key, and index metadata for a schema.
 *
 * Every view read here except `sys.schemas` is metadata-visibility filtered —
 * "limited to securables that a user either owns, or on which the user was
 * granted some permission" — so a low-privilege login gets a silently partial
 * result rather than an error.
 * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-information-schema-views/system-information-schema-views-transact-sql
 * @see https://learn.microsoft.com/en-us/sql/relational-databases/security/metadata-visibility-configuration
 */
export async function executeIntrospect(
  pool: sql.ConnectionPool,
  schemaName: string,
  signal?: AbortSignal
): Promise<MSSQLIntrospectionResult> {
  /**
   * `sys.schemas` rather than `INFORMATION_SCHEMA.SCHEMATA` because it needs
   * only membership in `public` and carries no metadata-visibility caveat.
   * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/schemas-catalog-views-sys-schemas
   */
  const schemasResult = await executeMssqlRequest<SchemaRow>(
    pool.request(),
    `SELECT s.name AS SCHEMA_NAME
     FROM sys.schemas s
     WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest',
       'db_accessadmin', 'db_backupoperator', 'db_datareader', 'db_datawriter',
       'db_ddladmin', 'db_denydatareader', 'db_denydatawriter', 'db_owner', 'db_securityadmin')
     ORDER BY s.name`,
    signal
  )
  const schemas = schemasResult.recordset.map((row: SchemaRow) => row.SCHEMA_NAME)

  const tablesResult = await executeMssqlRequest<TableRow>(
    pool.request().input('schema', schemaName),
    `SELECT TABLE_NAME, TABLE_SCHEMA
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = @schema AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    signal
  )

  const tableRows = tablesResult.recordset as TableRow[]
  if (tableRows.length === 0) return { tables: [], schemas }

  /**
   * The column, primary key, foreign key, and index reads below are filtered by
   * schema and grouped in memory, rather than run once per table. Per-table they
   * were four round trips each — a 500-table schema meant ~2,000 sequential
   * queries, every one under its own connection timeout.
   */
  const columnsResult = await executeMssqlRequest<ColumnRow>(
    pool.request().input('schema', schemaName),
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = @schema
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    signal
  )

  const pkResult = await executeMssqlRequest<KeyColumnRow>(
    pool.request().input('schema', schemaName),
    `SELECT tc.TABLE_NAME, kcu.COLUMN_NAME
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
     JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
       AND tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
     WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
       AND tc.TABLE_SCHEMA = @schema
     ORDER BY tc.TABLE_NAME, kcu.ORDINAL_POSITION`,
    signal
  )

  const fkResult = await executeMssqlRequest<ForeignKeyRow>(
    pool.request().input('schema', schemaName),
    /**
     * Resolved through the catalog views rather than
     * `INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS`, which reaches the
     * referenced side by joining `TABLE_CONSTRAINTS` — a view that returns
     * "one row for each table constraint" and so has no row at all when a
     * foreign key references a unique *index*, silently dropping the key.
     * The catalog views resolve the referenced table and column by ID.
     * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-foreign-key-columns-transact-sql
     * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-information-schema-views/table-constraints-transact-sql
     */
    `SELECT
         pt.name AS TABLE_NAME,
         pc.name AS COLUMN_NAME,
         rs.name AS REFERENCED_TABLE_SCHEMA,
         rt.name AS REFERENCED_TABLE_NAME,
         rc.name AS REFERENCED_COLUMN_NAME
       FROM sys.foreign_keys fk
       JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
       JOIN sys.tables pt ON pt.object_id = fk.parent_object_id
       JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
       JOIN sys.columns pc
         ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
       JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
       JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
       JOIN sys.columns rc
         ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
       WHERE ps.name = @schema
       ORDER BY pt.name, fk.name, fkc.constraint_column_id`,
    signal
  )

  const indexResult = await executeMssqlRequest<IndexRow>(
    pool.request().input('schema', schemaName),
    /**
     * `key_ordinal > 0` restricts the result to key columns: it is the
     * "ordinal (1-based) within set of key-columns", and `0` marks INCLUDEd
     * non-key columns, partitioning columns, **and every column of an XML,
     * spatial, columnstore, or JSON index**. The partitioning columns are
     * why `is_included_column` alone is not enough — those report `0` for it
     * too. The index families are the cost of the filter: they contribute no
     * key column, so they are absent from the result rather than listed with
     * an empty column set. Rowstore keys, which is what a query planner
     * reader is after, are reported in full.
     *
     * `is_hypothetical = 0` drops the statistics-only indexes the Database
     * Engine Tuning Advisor leaves behind ("can't be used directly as a data
     * access path"), and `is_disabled = 0` drops indexes that exist but are
     * not maintained. Reporting either as a live index misleads.
     *
     * `is_primary_key = 0` keeps the primary key out, since `primaryKey`
     * carries it already. A UNIQUE *constraint* is deliberately left in: it
     * is a unique index and nothing else in the result reports it.
     * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-index-columns-transact-sql
     * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-indexes-transact-sql
     */
    `SELECT t.name AS TABLE_NAME, i.name AS INDEX_NAME, c.name AS COLUMN_NAME,
              i.is_unique AS IS_UNIQUE
       FROM sys.indexes i
       JOIN sys.index_columns ic
         ON i.object_id = ic.object_id AND i.index_id = ic.index_id
       JOIN sys.columns c
         ON ic.object_id = c.object_id AND ic.column_id = c.column_id
       JOIN sys.tables t ON i.object_id = t.object_id
       JOIN sys.schemas s ON t.schema_id = s.schema_id
       WHERE s.name = @schema
         AND i.is_primary_key = 0
         AND i.is_hypothetical = 0
         AND i.is_disabled = 0
         AND i.name IS NOT NULL
         AND ic.key_ordinal > 0
       ORDER BY t.name, i.name, ic.key_ordinal`,
    signal
  )

  /** Groups rows by their `TABLE_NAME`, preserving each group's server order. */
  function groupByTable<TRow extends { TABLE_NAME: string }>(rows: TRow[]): Map<string, TRow[]> {
    const grouped = new Map<string, TRow[]>()
    for (const row of rows) {
      const existing = grouped.get(row.TABLE_NAME)
      if (existing) existing.push(row)
      else grouped.set(row.TABLE_NAME, [row])
    }
    return grouped
  }

  const columnsByTable = groupByTable(columnsResult.recordset as ColumnRow[])
  const pkByTable = groupByTable(pkResult.recordset as KeyColumnRow[])
  const fkByTable = groupByTable(fkResult.recordset as ForeignKeyRow[])
  const indexRowsByTable = groupByTable(indexResult.recordset as IndexRow[])

  const tables: MSSQLIntrospectionResult['tables'] = []

  for (const tableRow of tableRows) {
    const tableName = tableRow.TABLE_NAME
    const tableSchema = tableRow.TABLE_SCHEMA

    const primaryKeyColumns = (pkByTable.get(tableName) ?? []).map((row) => row.COLUMN_NAME)

    const foreignKeys = (fkByTable.get(tableName) ?? []).map((row) => ({
      column: row.COLUMN_NAME,
      referencesSchema: row.REFERENCED_TABLE_SCHEMA,
      referencesTable: row.REFERENCED_TABLE_NAME,
      referencesColumn: row.REFERENCED_COLUMN_NAME,
    }))

    const fkByColumn = new Map<string, (typeof foreignKeys)[number]>()
    for (const fk of foreignKeys) {
      if (!fkByColumn.has(fk.column)) fkByColumn.set(fk.column, fk)
    }

    const indexMap = new Map<string, { name: string; columns: string[]; unique: boolean }>()
    for (const row of indexRowsByTable.get(tableName) ?? []) {
      const indexName = row.INDEX_NAME
      if (!indexMap.has(indexName)) {
        indexMap.set(indexName, { name: indexName, columns: [], unique: Boolean(row.IS_UNIQUE) })
      }
      indexMap.get(indexName)!.columns.push(row.COLUMN_NAME)
    }
    const indexes = Array.from(indexMap.values())

    const primaryKeySet = new Set(primaryKeyColumns)

    const columns = (columnsByTable.get(tableName) ?? []).map((col) => {
      const columnName = col.COLUMN_NAME
      const fk = fkByColumn.get(columnName)

      return {
        name: columnName,
        type: col.DATA_TYPE,
        nullable: col.IS_NULLABLE === 'YES',
        default: col.COLUMN_DEFAULT ?? null,
        isPrimaryKey: primaryKeySet.has(columnName),
        isForeignKey: fk !== undefined,
        ...(fk && {
          references: {
            schema: fk.referencesSchema,
            table: fk.referencesTable,
            column: fk.referencesColumn,
          },
        }),
      }
    })

    tables.push({
      name: tableName,
      schema: tableSchema,
      columns,
      primaryKey: primaryKeyColumns,
      foreignKeys,
      indexes,
    })
  }

  return { tables, schemas }
}
