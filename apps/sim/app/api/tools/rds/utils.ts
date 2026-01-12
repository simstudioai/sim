import {
  ExecuteStatementCommand,
  type ExecuteStatementCommandOutput,
  type Field,
  RDSDataClient,
  type SqlParameter,
} from '@aws-sdk/client-rds-data'
import type { RdsConnectionConfig } from '@/tools/rds/types'

export function createRdsClient(config: RdsConnectionConfig): RDSDataClient {
  return new RDSDataClient({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

export async function executeStatement(
  client: RDSDataClient,
  resourceArn: string,
  secretArn: string,
  database: string | undefined,
  sql: string,
  parameters?: SqlParameter[]
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  const command = new ExecuteStatementCommand({
    resourceArn,
    secretArn,
    ...(database && { database }),
    sql,
    ...(parameters && parameters.length > 0 && { parameters }),
    includeResultMetadata: true,
  })

  const response = await client.send(command)
  const rows = parseRdsResponse(response)

  return {
    rows,
    rowCount: response.numberOfRecordsUpdated ?? rows.length,
  }
}

function parseRdsResponse(response: ExecuteStatementCommandOutput): Record<string, unknown>[] {
  if (!response.records || !response.columnMetadata) {
    return []
  }

  const columnNames = response.columnMetadata.map((col) => col.name || col.label || 'unknown')

  return response.records.map((record) => {
    const row: Record<string, unknown> = {}
    record.forEach((field, index) => {
      const columnName = columnNames[index] || `column_${index}`
      row[columnName] = parseFieldValue(field)
    })
    return row
  })
}

function parseFieldValue(field: Field): unknown {
  if (field.isNull) return null
  if (field.stringValue !== undefined) return field.stringValue
  if (field.longValue !== undefined) return field.longValue
  if (field.doubleValue !== undefined) return field.doubleValue
  if (field.booleanValue !== undefined) return field.booleanValue
  if (field.blobValue !== undefined) return Buffer.from(field.blobValue).toString('base64')
  if (field.arrayValue !== undefined) {
    const arr = field.arrayValue
    if (arr.stringValues) return arr.stringValues
    if (arr.longValues) return arr.longValues
    if (arr.doubleValues) return arr.doubleValues
    if (arr.booleanValues) return arr.booleanValues
    if (arr.arrayValues) return arr.arrayValues.map((f) => parseFieldValue({ arrayValue: f }))
    return []
  }
  return null
}

export function validateQuery(query: string): { isValid: boolean; error?: string } {
  const trimmedQuery = query.trim().toLowerCase()

  const allowedStatements = /^(select|insert|update|delete|with|explain|show)\s+/i
  if (!allowedStatements.test(trimmedQuery)) {
    return {
      isValid: false,
      error: 'Only SELECT, INSERT, UPDATE, DELETE, WITH, EXPLAIN, and SHOW statements are allowed',
    }
  }

  return { isValid: true }
}

export function sanitizeIdentifier(identifier: string): string {
  if (identifier.includes('.')) {
    const parts = identifier.split('.')
    return parts.map((part) => sanitizeSingleIdentifier(part)).join('.')
  }

  return sanitizeSingleIdentifier(identifier)
}

function sanitizeSingleIdentifier(identifier: string): string {
  const cleaned = identifier.replace(/`/g, '').replace(/"/g, '')

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleaned)) {
    throw new Error(
      `Invalid identifier: ${identifier}. Identifiers must start with a letter or underscore and contain only letters, numbers, and underscores.`
    )
  }

  return cleaned
}

/**
 * Convert a JS value to an RDS Data API SqlParameter value
 */
function toSqlParameterValue(value: unknown): SqlParameter['value'] {
  if (value === null || value === undefined) {
    return { isNull: true }
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value }
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { longValue: value }
    }
    return { doubleValue: value }
  }
  if (typeof value === 'string') {
    return { stringValue: value }
  }
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return { blobValue: value }
  }
  // Objects/arrays as JSON strings
  return { stringValue: JSON.stringify(value) }
}

/**
 * Build parameterized INSERT query
 */
export async function executeInsert(
  client: RDSDataClient,
  resourceArn: string,
  secretArn: string,
  database: string | undefined,
  table: string,
  data: Record<string, unknown>
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  const sanitizedTable = sanitizeIdentifier(table)
  const columns = Object.keys(data)
  const sanitizedColumns = columns.map((col) => sanitizeIdentifier(col))

  const placeholders = columns.map((col) => `:${col}`)
  const parameters: SqlParameter[] = columns.map((col) => ({
    name: col,
    value: toSqlParameterValue(data[col]),
  }))

  const sql = `INSERT INTO ${sanitizedTable} (${sanitizedColumns.join(', ')}) VALUES (${placeholders.join(', ')})`

  return executeStatement(client, resourceArn, secretArn, database, sql, parameters)
}

/**
 * Build parameterized UPDATE query with conditions
 */
export async function executeUpdate(
  client: RDSDataClient,
  resourceArn: string,
  secretArn: string,
  database: string | undefined,
  table: string,
  data: Record<string, unknown>,
  conditions: Record<string, unknown>
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  const sanitizedTable = sanitizeIdentifier(table)

  // Build SET clause with parameters
  const dataColumns = Object.keys(data)
  const setClause = dataColumns.map((col) => `${sanitizeIdentifier(col)} = :set_${col}`).join(', ')

  // Build WHERE clause with parameters
  const conditionColumns = Object.keys(conditions)
  if (conditionColumns.length === 0) {
    throw new Error('At least one condition is required for UPDATE operations')
  }
  const whereClause = conditionColumns
    .map((col) => `${sanitizeIdentifier(col)} = :where_${col}`)
    .join(' AND ')

  // Build parameters array (prefixed to avoid name collisions)
  const parameters: SqlParameter[] = [
    ...dataColumns.map((col) => ({
      name: `set_${col}`,
      value: toSqlParameterValue(data[col]),
    })),
    ...conditionColumns.map((col) => ({
      name: `where_${col}`,
      value: toSqlParameterValue(conditions[col]),
    })),
  ]

  const sql = `UPDATE ${sanitizedTable} SET ${setClause} WHERE ${whereClause}`

  return executeStatement(client, resourceArn, secretArn, database, sql, parameters)
}

/**
 * Build parameterized DELETE query with conditions
 */
export async function executeDelete(
  client: RDSDataClient,
  resourceArn: string,
  secretArn: string,
  database: string | undefined,
  table: string,
  conditions: Record<string, unknown>
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  const sanitizedTable = sanitizeIdentifier(table)

  // Build WHERE clause with parameters
  const conditionColumns = Object.keys(conditions)
  if (conditionColumns.length === 0) {
    throw new Error('At least one condition is required for DELETE operations')
  }
  const whereClause = conditionColumns
    .map((col) => `${sanitizeIdentifier(col)} = :${col}`)
    .join(' AND ')

  const parameters: SqlParameter[] = conditionColumns.map((col) => ({
    name: col,
    value: toSqlParameterValue(conditions[col]),
  }))

  const sql = `DELETE FROM ${sanitizedTable} WHERE ${whereClause}`

  return executeStatement(client, resourceArn, secretArn, database, sql, parameters)
}

export type RdsEngine = 'aurora-postgresql' | 'aurora-mysql'

export interface RdsIntrospectionResult {
  engine: RdsEngine
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

/**
 * Detects the database engine by querying SELECT VERSION()
 */
export async function detectEngine(
  client: RDSDataClient,
  resourceArn: string,
  secretArn: string,
  database: string | undefined
): Promise<RdsEngine> {
  const result = await executeStatement(
    client,
    resourceArn,
    secretArn,
    database,
    'SELECT VERSION()'
  )

  if (result.rows.length > 0) {
    const versionRow = result.rows[0] as Record<string, unknown>
    const versionValue = Object.values(versionRow)[0]
    const versionString = String(versionValue).toLowerCase()

    if (versionString.includes('postgresql') || versionString.includes('postgres')) {
      return 'aurora-postgresql'
    }
    if (versionString.includes('mysql') || versionString.includes('mariadb')) {
      return 'aurora-mysql'
    }
  }

  throw new Error('Unable to detect database engine. Please specify the engine parameter.')
}

/**
 * Introspects PostgreSQL schema using INFORMATION_SCHEMA
 */
async function introspectPostgresql(
  client: RDSDataClient,
  resourceArn: string,
  secretArn: string,
  database: string | undefined,
  schemaName: string
): Promise<RdsIntrospectionResult> {
  const schemasResult = await executeStatement(
    client,
    resourceArn,
    secretArn,
    database,
    `SELECT schema_name FROM information_schema.schemata
     WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
     ORDER BY schema_name`
  )
  const schemas = schemasResult.rows.map((row) => (row as { schema_name: string }).schema_name)

  const tablesResult = await executeStatement(
    client,
    resourceArn,
    secretArn,
    database,
    `SELECT table_name, table_schema
     FROM information_schema.tables
     WHERE table_schema = :schemaName
       AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [{ name: 'schemaName', value: { stringValue: schemaName } }]
  )

  const tables = []

  for (const tableRow of tablesResult.rows) {
    const row = tableRow as { table_name: string; table_schema: string }
    const tableName = row.table_name
    const tableSchema = row.table_schema

    const columnsResult = await executeStatement(
      client,
      resourceArn,
      secretArn,
      database,
      `SELECT
         c.column_name,
         c.data_type,
         c.is_nullable,
         c.column_default,
         c.udt_name
       FROM information_schema.columns c
       WHERE c.table_schema = :tableSchema
         AND c.table_name = :tableName
       ORDER BY c.ordinal_position`,
      [
        { name: 'tableSchema', value: { stringValue: tableSchema } },
        { name: 'tableName', value: { stringValue: tableName } },
      ]
    )

    const pkResult = await executeStatement(
      client,
      resourceArn,
      secretArn,
      database,
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY'
         AND tc.table_schema = :tableSchema
         AND tc.table_name = :tableName`,
      [
        { name: 'tableSchema', value: { stringValue: tableSchema } },
        { name: 'tableName', value: { stringValue: tableName } },
      ]
    )
    const primaryKeyColumns = pkResult.rows.map((r) => (r as { column_name: string }).column_name)

    const fkResult = await executeStatement(
      client,
      resourceArn,
      secretArn,
      database,
      `SELECT
         kcu.column_name,
         ccu.table_name AS foreign_table_name,
         ccu.column_name AS foreign_column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = :tableSchema
         AND tc.table_name = :tableName`,
      [
        { name: 'tableSchema', value: { stringValue: tableSchema } },
        { name: 'tableName', value: { stringValue: tableName } },
      ]
    )

    const foreignKeys = fkResult.rows.map((r) => {
      const fkRow = r as {
        column_name: string
        foreign_table_name: string
        foreign_column_name: string
      }
      return {
        column: fkRow.column_name,
        referencesTable: fkRow.foreign_table_name,
        referencesColumn: fkRow.foreign_column_name,
      }
    })

    const fkColumnSet = new Set(foreignKeys.map((fk) => fk.column))

    const indexesResult = await executeStatement(
      client,
      resourceArn,
      secretArn,
      database,
      `SELECT
         i.relname AS index_name,
         a.attname AS column_name,
         ix.indisunique AS is_unique
       FROM pg_class t
       JOIN pg_index ix ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE t.relkind = 'r'
         AND n.nspname = :tableSchema
         AND t.relname = :tableName
         AND NOT ix.indisprimary
       ORDER BY i.relname, a.attnum`,
      [
        { name: 'tableSchema', value: { stringValue: tableSchema } },
        { name: 'tableName', value: { stringValue: tableName } },
      ]
    )

    const indexMap = new Map<string, { name: string; columns: string[]; unique: boolean }>()
    for (const idxRow of indexesResult.rows) {
      const idx = idxRow as { index_name: string; column_name: string; is_unique: boolean }
      const indexName = idx.index_name
      if (!indexMap.has(indexName)) {
        indexMap.set(indexName, {
          name: indexName,
          columns: [],
          unique: idx.is_unique,
        })
      }
      indexMap.get(indexName)!.columns.push(idx.column_name)
    }
    const indexes = Array.from(indexMap.values())

    const columns = columnsResult.rows.map((colRow) => {
      const col = colRow as {
        column_name: string
        data_type: string
        is_nullable: string
        column_default: string | null
        udt_name: string
      }
      const columnName = col.column_name
      const fk = foreignKeys.find((f) => f.column === columnName)

      return {
        name: columnName,
        type: col.data_type === 'USER-DEFINED' ? col.udt_name : col.data_type,
        nullable: col.is_nullable === 'YES',
        default: col.column_default,
        isPrimaryKey: primaryKeyColumns.includes(columnName),
        isForeignKey: fkColumnSet.has(columnName),
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

  return { engine: 'aurora-postgresql', tables, schemas }
}

/**
 * Introspects MySQL schema using INFORMATION_SCHEMA
 */
async function introspectMysql(
  client: RDSDataClient,
  resourceArn: string,
  secretArn: string,
  database: string | undefined,
  schemaName: string
): Promise<RdsIntrospectionResult> {
  const schemasResult = await executeStatement(
    client,
    resourceArn,
    secretArn,
    database,
    `SELECT SCHEMA_NAME as schema_name FROM information_schema.SCHEMATA
     WHERE SCHEMA_NAME NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
     ORDER BY SCHEMA_NAME`
  )
  const schemas = schemasResult.rows.map((row) => (row as { schema_name: string }).schema_name)

  const tablesResult = await executeStatement(
    client,
    resourceArn,
    secretArn,
    database,
    `SELECT TABLE_NAME as table_name, TABLE_SCHEMA as table_schema
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = :schemaName
       AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [{ name: 'schemaName', value: { stringValue: schemaName } }]
  )

  const tables = []

  for (const tableRow of tablesResult.rows) {
    const row = tableRow as { table_name: string; table_schema: string }
    const tableName = row.table_name
    const tableSchema = row.table_schema

    const columnsResult = await executeStatement(
      client,
      resourceArn,
      secretArn,
      database,
      `SELECT
         COLUMN_NAME as column_name,
         DATA_TYPE as data_type,
         IS_NULLABLE as is_nullable,
         COLUMN_DEFAULT as column_default,
         COLUMN_TYPE as column_type,
         COLUMN_KEY as column_key
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = :tableSchema
         AND TABLE_NAME = :tableName
       ORDER BY ORDINAL_POSITION`,
      [
        { name: 'tableSchema', value: { stringValue: tableSchema } },
        { name: 'tableName', value: { stringValue: tableName } },
      ]
    )

    const pkResult = await executeStatement(
      client,
      resourceArn,
      secretArn,
      database,
      `SELECT COLUMN_NAME as column_name
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = :tableSchema
         AND TABLE_NAME = :tableName
         AND CONSTRAINT_NAME = 'PRIMARY'
       ORDER BY ORDINAL_POSITION`,
      [
        { name: 'tableSchema', value: { stringValue: tableSchema } },
        { name: 'tableName', value: { stringValue: tableName } },
      ]
    )
    const primaryKeyColumns = pkResult.rows.map((r) => (r as { column_name: string }).column_name)

    const fkResult = await executeStatement(
      client,
      resourceArn,
      secretArn,
      database,
      `SELECT
         kcu.COLUMN_NAME as column_name,
         kcu.REFERENCED_TABLE_NAME as foreign_table_name,
         kcu.REFERENCED_COLUMN_NAME as foreign_column_name
       FROM information_schema.KEY_COLUMN_USAGE kcu
       WHERE kcu.TABLE_SCHEMA = :tableSchema
         AND kcu.TABLE_NAME = :tableName
         AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
      [
        { name: 'tableSchema', value: { stringValue: tableSchema } },
        { name: 'tableName', value: { stringValue: tableName } },
      ]
    )

    const foreignKeys = fkResult.rows.map((r) => {
      const fkRow = r as {
        column_name: string
        foreign_table_name: string
        foreign_column_name: string
      }
      return {
        column: fkRow.column_name,
        referencesTable: fkRow.foreign_table_name,
        referencesColumn: fkRow.foreign_column_name,
      }
    })

    const fkColumnSet = new Set(foreignKeys.map((fk) => fk.column))

    const indexesResult = await executeStatement(
      client,
      resourceArn,
      secretArn,
      database,
      `SELECT
         INDEX_NAME as index_name,
         COLUMN_NAME as column_name,
         NON_UNIQUE as non_unique
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = :tableSchema
         AND TABLE_NAME = :tableName
         AND INDEX_NAME != 'PRIMARY'
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [
        { name: 'tableSchema', value: { stringValue: tableSchema } },
        { name: 'tableName', value: { stringValue: tableName } },
      ]
    )

    const indexMap = new Map<string, { name: string; columns: string[]; unique: boolean }>()
    for (const idxRow of indexesResult.rows) {
      const idx = idxRow as { index_name: string; column_name: string; non_unique: number }
      const indexName = idx.index_name
      if (!indexMap.has(indexName)) {
        indexMap.set(indexName, {
          name: indexName,
          columns: [],
          unique: idx.non_unique === 0,
        })
      }
      indexMap.get(indexName)!.columns.push(idx.column_name)
    }
    const indexes = Array.from(indexMap.values())

    const columns = columnsResult.rows.map((colRow) => {
      const col = colRow as {
        column_name: string
        data_type: string
        is_nullable: string
        column_default: string | null
        column_type: string
        column_key: string
      }
      const columnName = col.column_name
      const fk = foreignKeys.find((f) => f.column === columnName)

      return {
        name: columnName,
        type: col.column_type || col.data_type,
        nullable: col.is_nullable === 'YES',
        default: col.column_default,
        isPrimaryKey: col.column_key === 'PRI',
        isForeignKey: fkColumnSet.has(columnName),
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

  return { engine: 'aurora-mysql', tables, schemas }
}

/**
 * Introspects RDS Aurora database schema with auto-detection of engine type
 */
export async function executeIntrospect(
  client: RDSDataClient,
  resourceArn: string,
  secretArn: string,
  database: string | undefined,
  schemaName?: string,
  engine?: RdsEngine
): Promise<RdsIntrospectionResult> {
  const detectedEngine = engine || (await detectEngine(client, resourceArn, secretArn, database))

  if (detectedEngine === 'aurora-postgresql') {
    const schema = schemaName || 'public'
    return introspectPostgresql(client, resourceArn, secretArn, database, schema)
  }
  const schema = schemaName || database || ''
  if (!schema) {
    throw new Error('Schema or database name is required for MySQL introspection')
  }
  return introspectMysql(client, resourceArn, secretArn, database, schema)
}
