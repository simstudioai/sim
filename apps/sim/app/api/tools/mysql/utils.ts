import mysql from 'mysql2/promise'

export interface MySQLConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  ssl?: 'disabled' | 'required' | 'preferred'
}

export async function createMySQLConnection(config: MySQLConnectionConfig) {
  const connectionConfig: mysql.ConnectionOptions = {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
  }

  if (config.ssl === 'disabled') {
  } else if (config.ssl === 'required') {
    connectionConfig.ssl = { rejectUnauthorized: true }
  } else if (config.ssl === 'preferred') {
    connectionConfig.ssl = { rejectUnauthorized: false }
  }

  return mysql.createConnection(connectionConfig)
}

export async function executeQuery(
  connection: mysql.Connection,
  query: string,
  values?: unknown[]
) {
  const [rows, fields] = await connection.execute(query, values)

  if (Array.isArray(rows)) {
    return {
      rows: rows as unknown[],
      rowCount: rows.length,
      fields,
    }
  }

  return {
    rows: [],
    rowCount: (rows as mysql.ResultSetHeader).affectedRows || 0,
    fields,
  }
}

export function validateQuery(query: string): { isValid: boolean; error?: string } {
  const trimmedQuery = query.trim().toLowerCase()

  const allowedStatements = /^(select|insert|update|delete|with|show|describe|explain)\s+/i
  if (!allowedStatements.test(trimmedQuery)) {
    return {
      isValid: false,
      error:
        'Only SELECT, INSERT, UPDATE, DELETE, WITH, SHOW, DESCRIBE, and EXPLAIN statements are allowed',
    }
  }

  return { isValid: true }
}

export function buildInsertQuery(table: string, data: Record<string, unknown>) {
  const sanitizedTable = sanitizeIdentifier(table)
  const columns = Object.keys(data)
  const values = Object.values(data)
  const placeholders = columns.map(() => '?').join(', ')

  const query = `INSERT INTO ${sanitizedTable} (${columns.map(sanitizeIdentifier).join(', ')}) VALUES (${placeholders})`

  return { query, values }
}

export function buildUpdateQuery(table: string, data: Record<string, unknown>, where: string) {
  validateWhereClause(where)

  const sanitizedTable = sanitizeIdentifier(table)
  const columns = Object.keys(data)
  const values = Object.values(data)

  const setClause = columns.map((col) => `${sanitizeIdentifier(col)} = ?`).join(', ')
  const query = `UPDATE ${sanitizedTable} SET ${setClause} WHERE ${where}`

  return { query, values }
}

export function buildDeleteQuery(table: string, where: string) {
  validateWhereClause(where)

  const sanitizedTable = sanitizeIdentifier(table)
  const query = `DELETE FROM ${sanitizedTable} WHERE ${where}`

  return { query, values: [] }
}

/**
 * Validates a WHERE clause to prevent SQL injection attacks
 * @param where - The WHERE clause string to validate
 * @throws {Error} If the WHERE clause contains potentially dangerous patterns
 */
function validateWhereClause(where: string): void {
  const dangerousPatterns = [
    // DDL and DML injection via stacked queries
    /;\s*(drop|delete|insert|update|create|alter|grant|revoke)/i,
    // Union-based injection
    /union\s+(all\s+)?select/i,
    // File operations
    /into\s+outfile/i,
    /into\s+dumpfile/i,
    /load_file\s*\(/i,
    // Comment-based injection (can truncate query)
    /--/,
    /\/\*/,
    /\*\//,
    // Tautologies - always true/false conditions using backreferences
    // Matches OR 'x'='x' or OR x=x (same value both sides) but NOT OR col='value'
    /\bor\s+(['"]?)(\w+)\1\s*=\s*\1\2\1/i,
    /\bor\s+true\b/i,
    /\bor\s+false\b/i,
    // AND tautologies (less common but still used in attacks)
    /\band\s+(['"]?)(\w+)\1\s*=\s*\1\2\1/i,
    /\band\s+true\b/i,
    /\band\s+false\b/i,
    // Time-based blind injection
    /\bsleep\s*\(/i,
    /\bbenchmark\s*\(/i,
    /\bwaitfor\s+delay/i,
    // Stacked queries (any statement after semicolon)
    /;\s*\w+/,
    // Information schema queries
    /information_schema/i,
    /mysql\./i,
    // System functions and procedures
    /\bxp_cmdshell/i,
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
  const cleaned = identifier.replace(/`/g, '')

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleaned)) {
    throw new Error(
      `Invalid identifier: ${identifier}. Identifiers must start with a letter or underscore and contain only letters, numbers, and underscores.`
    )
  }

  return `\`${cleaned}\``
}

export interface MySQLIntrospectionResult {
  tables: Array<{
    name: string
    database: string
    columns: Array<{
      name: string
      type: string
      nullable: boolean
      default: string | null
      isPrimaryKey: boolean
      isForeignKey: boolean
      autoIncrement: boolean
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
  databases: string[]
}

export async function executeIntrospect(
  connection: mysql.Connection,
  databaseName: string
): Promise<MySQLIntrospectionResult> {
  const [databasesRows] = await connection.execute<mysql.RowDataPacket[]>(
    `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA
     WHERE SCHEMA_NAME NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
     ORDER BY SCHEMA_NAME`
  )
  const databases = databasesRows.map((row) => row.SCHEMA_NAME)

  const [tablesRows] = await connection.execute<mysql.RowDataPacket[]>(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [databaseName]
  )

  const tables = []

  for (const tableRow of tablesRows) {
    const tableName = tableRow.TABLE_NAME

    const [columnsRows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [databaseName, tableName]
    )

    const [pkRows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
       ORDER BY ORDINAL_POSITION`,
      [databaseName, tableName]
    )
    const primaryKeyColumns = pkRows.map((row) => row.COLUMN_NAME)

    const [fkRows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
      [databaseName, tableName]
    )

    const foreignKeys = fkRows.map((row) => ({
      column: row.COLUMN_NAME,
      referencesTable: row.REFERENCED_TABLE_NAME,
      referencesColumn: row.REFERENCED_COLUMN_NAME,
    }))

    const fkColumnSet = new Set(foreignKeys.map((fk) => fk.column))

    const [indexRows] = await connection.execute<mysql.RowDataPacket[]>(
      `SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX, NON_UNIQUE
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME != 'PRIMARY'
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [databaseName, tableName]
    )

    const indexMap = new Map<string, { name: string; columns: string[]; unique: boolean }>()
    for (const row of indexRows) {
      const indexName = row.INDEX_NAME
      if (!indexMap.has(indexName)) {
        indexMap.set(indexName, {
          name: indexName,
          columns: [],
          unique: row.NON_UNIQUE === 0,
        })
      }
      indexMap.get(indexName)!.columns.push(row.COLUMN_NAME)
    }
    const indexes = Array.from(indexMap.values())

    const columns = columnsRows.map((col) => {
      const columnName = col.COLUMN_NAME
      const fk = foreignKeys.find((f) => f.column === columnName)
      const isAutoIncrement = col.EXTRA?.toLowerCase().includes('auto_increment') || false

      return {
        name: columnName,
        type: col.COLUMN_TYPE || col.DATA_TYPE,
        nullable: col.IS_NULLABLE === 'YES',
        default: col.COLUMN_DEFAULT,
        isPrimaryKey: primaryKeyColumns.includes(columnName),
        isForeignKey: fkColumnSet.has(columnName),
        autoIncrement: isAutoIncrement,
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
      database: databaseName,
      columns,
      primaryKey: primaryKeyColumns,
      foreignKeys,
      indexes,
    })
  }

  return { tables, databases }
}
