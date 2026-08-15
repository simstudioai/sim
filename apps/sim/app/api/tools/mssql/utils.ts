import sql from 'mssql'
import { validateDatabaseHost } from '@/lib/core/security/input-validation.server'

export interface MSSQLConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  encrypt: 'enabled' | 'disabled'
  trustServerCertificate: 'enabled' | 'disabled'
  instanceName?: string
  connectionTimeout: number
}

/**
 * Opens a single-connection `mssql` pool after SSRF-validating the host.
 *
 * The hostname (not the resolved IP) is passed as `server` so TLS certificate
 * validation and SQL Server Browser instance lookup keep working; the resolved
 * addresses are still checked against the private-IP blocklist first.
 *
 * `port` is deliberately omitted when `instanceName` is set — the driver docs
 * state the port must not be supplied for a named instance.
 * @see https://github.com/tediousjs/node-mssql#general-same-for-all-drivers
 * @see https://github.com/tediousjs/node-mssql#tedious
 */
export async function createMSSQLConnection(
  config: MSSQLConnectionConfig
): Promise<sql.ConnectionPool> {
  const hostValidation = await validateDatabaseHost(config.host, 'host')
  if (!hostValidation.isValid) {
    throw new Error(hostValidation.error)
  }

  const poolConfig: sql.config = {
    server: config.host,
    database: config.database,
    user: config.username,
    password: config.password,
    connectionTimeout: config.connectionTimeout,
    requestTimeout: config.connectionTimeout,
    pool: {
      max: 1,
      min: 0,
      idleTimeoutMillis: 20000,
    },
    options: {
      encrypt: config.encrypt === 'enabled',
      trustServerCertificate: config.trustServerCertificate === 'enabled',
      ...(config.instanceName ? { instanceName: config.instanceName } : {}),
    },
  }

  if (!config.instanceName) {
    poolConfig.port = config.port
  }

  const pool = new sql.ConnectionPool(poolConfig)
  await pool.connect()

  return pool
}

export interface MSSQLQueryResult {
  rows: unknown[]
  rowCount: number
}

/**
 * Runs a statement with positional values bound as `@param1`, `@param2`, … .
 *
 * `recordset` holds the first result set and `rowsAffected` holds one count per
 * statement, so a SELECT reports its row count and a DML statement reports the
 * summed affected rows.
 * @see https://github.com/tediousjs/node-mssql#request
 */
export async function executeQuery(
  pool: sql.ConnectionPool,
  query: string,
  values: unknown[] = []
): Promise<MSSQLQueryResult> {
  const request = pool.request()
  values.forEach((value, index) => {
    request.input(`param${index + 1}`, value)
  })

  const result = await request.query(query)
  const rows: unknown[] = result.recordset ?? []
  const affected = (result.rowsAffected ?? []).reduce(
    (total: number, count: number) => total + count,
    0
  )

  return {
    rows,
    rowCount: rows.length > 0 ? rows.length : affected,
  }
}

export function validateQuery(query: string): { isValid: boolean; error?: string } {
  const trimmedQuery = query.trim()

  const allowedStatements = /^(select|insert|update|delete|with|merge|exec|execute|declare)\s+/i
  if (!allowedStatements.test(trimmedQuery)) {
    return {
      isValid: false,
      error:
        'Only SELECT, INSERT, UPDATE, DELETE, WITH, MERGE, EXEC, EXECUTE, and DECLARE statements are allowed',
    }
  }

  return { isValid: true }
}

export function buildInsertQuery(table: string, data: Record<string, unknown>) {
  const sanitizedTable = sanitizeIdentifier(table)
  const columns = Object.keys(data)
  const values = Object.values(data)
  const placeholders = columns.map((_, index) => `@param${index + 1}`).join(', ')

  const query = `INSERT INTO ${sanitizedTable} (${columns.map(sanitizeIdentifier).join(', ')}) VALUES (${placeholders})`

  return { query, values }
}

export function buildUpdateQuery(table: string, data: Record<string, unknown>, where: string) {
  validateWhereClause(where)

  const sanitizedTable = sanitizeIdentifier(table)
  const columns = Object.keys(data)
  const values = Object.values(data)

  const setClause = columns
    .map((col, index) => `${sanitizeIdentifier(col)} = @param${index + 1}`)
    .join(', ')
  const query = `UPDATE ${sanitizedTable} SET ${setClause} WHERE ${where}`

  return { query, values }
}

export function buildDeleteQuery(table: string, where: string) {
  validateWhereClause(where)

  const sanitizedTable = sanitizeIdentifier(table)
  const query = `DELETE FROM ${sanitizedTable} WHERE ${where}`

  return { query, values: [] as unknown[] }
}

/**
 * Validates a WHERE clause to prevent SQL injection attacks
 * @param where - The WHERE clause string to validate
 * @throws {Error} If the WHERE clause contains potentially dangerous patterns
 */
function validateWhereClause(where: string): void {
  const dangerousPatterns = [
    // DDL and DML injection via stacked queries
    /;\s*(drop|delete|insert|update|create|alter|grant|revoke|truncate)/i,
    // Union-based injection
    /union\s+(all\s+)?select/i,
    // File and external data operations
    /\bopenrowset\s*\(/i,
    /\bopendatasource\s*\(/i,
    /\bbulk\s+insert\b/i,
    // Comment-based injection (can truncate query)
    /--/,
    /\/\*/,
    /\*\//,
    // Tautologies - always true/false conditions using backreferences
    /\bor\s+(['"]?)(\w+)\1\s*=\s*\1\2\1/i,
    /\bor\s+true\b/i,
    /\bor\s+false\b/i,
    /\band\s+(['"]?)(\w+)\1\s*=\s*\1\2\1/i,
    /\band\s+true\b/i,
    /\band\s+false\b/i,
    // Time-based blind injection
    /\bwaitfor\s+delay/i,
    // Stacked queries (any statement after semicolon)
    /;\s*\w+/,
    // Information schema / system catalog queries
    /information_schema/i,
    /\bsys\./i,
    // Extended stored procedures
    /\bxp_cmdshell/i,
    /\bsp_executesql/i,
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(where)) {
      throw new Error('WHERE clause contains potentially dangerous operation')
    }
  }
}

export function sanitizeIdentifier(identifier: string): string {
  if (identifier.includes('.')) {
    const parts = identifier.split('.')
    return parts.map((part) => sanitizeSingleIdentifier(part)).join('.')
  }

  return sanitizeSingleIdentifier(identifier)
}

function sanitizeSingleIdentifier(identifier: string): string {
  const cleaned = identifier.replace(/[[\]]/g, '')

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleaned)) {
    throw new Error(
      `Invalid identifier: ${identifier}. Identifiers must start with a letter or underscore and contain only letters, numbers, and underscores.`
    )
  }

  return `[${cleaned}]`
}

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
        table: string
        column: string
      }
    }>
    primaryKey: string[]
    foreignKeys: Array<{
      column: string
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
  COLUMN_NAME: string
  DATA_TYPE: string
  IS_NULLABLE: string
  COLUMN_DEFAULT: string | null
}

interface KeyColumnRow {
  COLUMN_NAME: string
}

interface ForeignKeyRow {
  COLUMN_NAME: string
  REFERENCED_TABLE_NAME: string
  REFERENCED_COLUMN_NAME: string
}

interface IndexRow {
  INDEX_NAME: string
  COLUMN_NAME: string
  IS_UNIQUE: boolean
}

/**
 * Reads table, column, key, and index metadata for a schema from the
 * INFORMATION_SCHEMA views and the `sys.indexes` catalog views.
 * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-information-schema-views/system-information-schema-views-transact-sql
 * @see https://learn.microsoft.com/en-us/sql/relational-databases/system-catalog-views/sys-indexes-transact-sql
 */
export async function executeIntrospect(
  pool: sql.ConnectionPool,
  schemaName: string
): Promise<MSSQLIntrospectionResult> {
  const schemasResult = await pool.request().query<SchemaRow>(
    `SELECT SCHEMA_NAME
     FROM INFORMATION_SCHEMA.SCHEMATA
     WHERE SCHEMA_NAME NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest',
       'db_accessadmin', 'db_backupoperator', 'db_datareader', 'db_datawriter',
       'db_ddladmin', 'db_denydatareader', 'db_denydatawriter', 'db_owner', 'db_securityadmin')
     ORDER BY SCHEMA_NAME`
  )
  const schemas = schemasResult.recordset.map((row: SchemaRow) => row.SCHEMA_NAME)

  const tablesResult = await pool
    .request()
    .input('schema', schemaName)
    .query<TableRow>(
      `SELECT TABLE_NAME, TABLE_SCHEMA
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = @schema AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`
    )

  const tables: MSSQLIntrospectionResult['tables'] = []

  for (const tableRow of tablesResult.recordset as TableRow[]) {
    const tableName = tableRow.TABLE_NAME
    const tableSchema = tableRow.TABLE_SCHEMA

    const columnsResult = await pool
      .request()
      .input('schema', tableSchema)
      .input('table', tableName)
      .query<ColumnRow>(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
         ORDER BY ORDINAL_POSITION`
      )

    const pkResult = await pool
      .request()
      .input('schema', tableSchema)
      .input('table', tableName)
      .query<KeyColumnRow>(
        `SELECT kcu.COLUMN_NAME
         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
         JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
           ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
           AND tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
         WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
           AND tc.TABLE_SCHEMA = @schema
           AND tc.TABLE_NAME = @table
         ORDER BY kcu.ORDINAL_POSITION`
      )
    const primaryKeyColumns = pkResult.recordset.map((row: KeyColumnRow) => row.COLUMN_NAME)

    const fkResult = await pool
      .request()
      .input('schema', tableSchema)
      .input('table', tableName)
      .query<ForeignKeyRow>(
        `SELECT
           fkcu.COLUMN_NAME AS COLUMN_NAME,
           pk.TABLE_NAME AS REFERENCED_TABLE_NAME,
           pkcu.COLUMN_NAME AS REFERENCED_COLUMN_NAME
         FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
         JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE fkcu
           ON rc.CONSTRAINT_NAME = fkcu.CONSTRAINT_NAME
           AND rc.CONSTRAINT_SCHEMA = fkcu.CONSTRAINT_SCHEMA
         JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS pk
           ON rc.UNIQUE_CONSTRAINT_NAME = pk.CONSTRAINT_NAME
           AND rc.UNIQUE_CONSTRAINT_SCHEMA = pk.CONSTRAINT_SCHEMA
         JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE pkcu
           ON pk.CONSTRAINT_NAME = pkcu.CONSTRAINT_NAME
           AND pk.CONSTRAINT_SCHEMA = pkcu.CONSTRAINT_SCHEMA
           AND pkcu.ORDINAL_POSITION = fkcu.ORDINAL_POSITION
         WHERE fkcu.TABLE_SCHEMA = @schema AND fkcu.TABLE_NAME = @table`
      )

    const foreignKeys = fkResult.recordset.map((row: ForeignKeyRow) => ({
      column: row.COLUMN_NAME,
      referencesTable: row.REFERENCED_TABLE_NAME,
      referencesColumn: row.REFERENCED_COLUMN_NAME,
    }))

    const fkByColumn = new Map<string, (typeof foreignKeys)[number]>()
    for (const fk of foreignKeys) {
      if (!fkByColumn.has(fk.column)) fkByColumn.set(fk.column, fk)
    }

    const indexResult = await pool
      .request()
      .input('schema', tableSchema)
      .input('table', tableName)
      .query<IndexRow>(
        `SELECT i.name AS INDEX_NAME, c.name AS COLUMN_NAME, i.is_unique AS IS_UNIQUE
         FROM sys.indexes i
         JOIN sys.index_columns ic
           ON i.object_id = ic.object_id AND i.index_id = ic.index_id
         JOIN sys.columns c
           ON ic.object_id = c.object_id AND ic.column_id = c.column_id
         JOIN sys.tables t ON i.object_id = t.object_id
         JOIN sys.schemas s ON t.schema_id = s.schema_id
         WHERE s.name = @schema
           AND t.name = @table
           AND i.is_primary_key = 0
           AND i.name IS NOT NULL
         ORDER BY i.name, ic.key_ordinal`
      )

    const indexMap = new Map<string, { name: string; columns: string[]; unique: boolean }>()
    for (const row of indexResult.recordset as IndexRow[]) {
      const indexName = row.INDEX_NAME
      if (!indexMap.has(indexName)) {
        indexMap.set(indexName, { name: indexName, columns: [], unique: row.IS_UNIQUE })
      }
      indexMap.get(indexName)!.columns.push(row.COLUMN_NAME)
    }
    const indexes = Array.from(indexMap.values())

    const primaryKeySet = new Set(primaryKeyColumns)

    const columns = columnsResult.recordset.map((col: ColumnRow) => {
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
