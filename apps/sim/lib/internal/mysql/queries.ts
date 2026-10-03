import type mysql from 'mysql2/promise'
import { executeMysqlCommand } from '@/lib/internal/mysql/client'

export interface MysqlRowsResult {
  rows: unknown[]
  rowCount: number
}

export interface MysqlIntrospectionResult {
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

interface DatabaseRow extends mysql.RowDataPacket {
  SCHEMA_NAME: string
}

interface TableRow extends mysql.RowDataPacket {
  TABLE_NAME: string
}

interface ColumnRow extends mysql.RowDataPacket {
  COLUMN_NAME: string
  DATA_TYPE: string
  COLUMN_TYPE: string
  IS_NULLABLE: string
  COLUMN_DEFAULT: string | null
  EXTRA?: string
}

interface PrimaryKeyRow extends mysql.RowDataPacket {
  COLUMN_NAME: string
}

interface ForeignKeyRow extends mysql.RowDataPacket {
  COLUMN_NAME: string
  REFERENCED_TABLE_NAME: string
  REFERENCED_COLUMN_NAME: string
}

interface IndexRow extends mysql.RowDataPacket {
  INDEX_NAME: string
  COLUMN_NAME: string
  NON_UNIQUE: number
}

export async function queryMysql(
  connection: mysql.Connection,
  query: string,
  values?: unknown[],
  signal?: AbortSignal
): Promise<MysqlRowsResult> {
  const result = await executeMysqlCommand(connection, query, values, signal)

  if (Array.isArray(result)) {
    return {
      rows: result,
      rowCount: result.length,
    }
  }

  return {
    rows: [],
    rowCount: (result as mysql.ResultSetHeader).affectedRows || 0,
  }
}

export function validateMysqlQuery(query: string): { isValid: boolean; error?: string } {
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

export function buildMysqlInsertQuery(table: string, data: Record<string, unknown>) {
  const sanitizedTable = sanitizeMysqlIdentifier(table)
  const columns = Object.keys(data)
  const values = Object.values(data)
  const placeholders = columns.map(() => '?').join(', ')
  const query = `INSERT INTO ${sanitizedTable} (${columns.map(sanitizeMysqlIdentifier).join(', ')}) VALUES (${placeholders})`

  return { query, values }
}

export function buildMysqlUpdateQuery(table: string, data: Record<string, unknown>, where: string) {
  validateWhereClause(where)

  const sanitizedTable = sanitizeMysqlIdentifier(table)
  const columns = Object.keys(data)
  const values = Object.values(data)
  const setClause = columns.map((column) => `${sanitizeMysqlIdentifier(column)} = ?`).join(', ')
  const query = `UPDATE ${sanitizedTable} SET ${setClause} WHERE ${where}`

  return { query, values }
}

export function buildMysqlDeleteQuery(table: string, where: string) {
  validateWhereClause(where)

  const sanitizedTable = sanitizeMysqlIdentifier(table)
  const query = `DELETE FROM ${sanitizedTable} WHERE ${where}`

  return { query, values: [] }
}

export function sanitizeMysqlIdentifier(identifier: string): string {
  if (identifier.includes('.')) {
    return identifier
      .split('.')
      .map((part) => sanitizeSingleIdentifier(part))
      .join('.')
  }

  return sanitizeSingleIdentifier(identifier)
}

export async function introspectMysqlDatabase(
  connection: mysql.Connection,
  databaseName: string,
  signal?: AbortSignal
): Promise<MysqlIntrospectionResult> {
  const databasesRows = await executeMysqlCommand<DatabaseRow[]>(
    connection,
    `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA
     WHERE SCHEMA_NAME NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
     ORDER BY SCHEMA_NAME`,
    undefined,
    signal
  )
  const databases = databasesRows.map((row) => row.SCHEMA_NAME)

  const tablesRows = await executeMysqlCommand<TableRow[]>(
    connection,
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [databaseName],
    signal
  )
  const tables: MysqlIntrospectionResult['tables'] = []

  for (const tableRow of tablesRows) {
    signal?.throwIfAborted()
    const tableName = tableRow.TABLE_NAME
    const queryValues = [databaseName, tableName]

    const columnsRows = await executeMysqlCommand<ColumnRow[]>(
      connection,
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      queryValues,
      signal
    )

    const primaryKeyRows = await executeMysqlCommand<PrimaryKeyRow[]>(
      connection,
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
       ORDER BY ORDINAL_POSITION`,
      queryValues,
      signal
    )
    const primaryKey = primaryKeyRows.map((row) => row.COLUMN_NAME)

    const foreignKeyRows = await executeMysqlCommand<ForeignKeyRow[]>(
      connection,
      `SELECT kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
      queryValues,
      signal
    )
    const foreignKeys = foreignKeyRows.map((row) => ({
      column: row.COLUMN_NAME,
      referencesTable: row.REFERENCED_TABLE_NAME,
      referencesColumn: row.REFERENCED_COLUMN_NAME,
    }))
    const foreignKeyColumns = new Set(foreignKeys.map((foreignKey) => foreignKey.column))

    const indexRows = await executeMysqlCommand<IndexRow[]>(
      connection,
      `SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX, NON_UNIQUE
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME != 'PRIMARY'
       ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      queryValues,
      signal
    )
    const indexesByName = new Map<string, { name: string; columns: string[]; unique: boolean }>()
    for (const row of indexRows) {
      const index = indexesByName.get(row.INDEX_NAME) ?? {
        name: row.INDEX_NAME,
        columns: [],
        unique: row.NON_UNIQUE === 0,
      }
      index.columns.push(row.COLUMN_NAME)
      indexesByName.set(row.INDEX_NAME, index)
    }

    const columns = columnsRows.map((column) => {
      const foreignKey = foreignKeys.find((candidate) => candidate.column === column.COLUMN_NAME)
      return {
        name: column.COLUMN_NAME,
        type: column.COLUMN_TYPE || column.DATA_TYPE,
        nullable: column.IS_NULLABLE === 'YES',
        default: column.COLUMN_DEFAULT,
        isPrimaryKey: primaryKey.includes(column.COLUMN_NAME),
        isForeignKey: foreignKeyColumns.has(column.COLUMN_NAME),
        autoIncrement: column.EXTRA?.toLowerCase().includes('auto_increment') || false,
        ...(foreignKey && {
          references: {
            table: foreignKey.referencesTable,
            column: foreignKey.referencesColumn,
          },
        }),
      }
    })

    tables.push({
      name: tableName,
      database: databaseName,
      columns,
      primaryKey,
      foreignKeys,
      indexes: Array.from(indexesByName.values()),
    })
  }

  return { tables, databases }
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

function validateWhereClause(where: string): void {
  const dangerousPatterns = [
    /;\s*(drop|delete|insert|update|create|alter|grant|revoke)/i,
    /union\s+(all\s+)?select/i,
    /into\s+outfile/i,
    /into\s+dumpfile/i,
    /load_file\s*\(/i,
    /--/,
    /\/\*/,
    /\*\//,
    /\bor\s+(['"]?)(\w+)\1\s*=\s*\1\2\1/i,
    /\bor\s+true\b/i,
    /\bor\s+false\b/i,
    /\band\s+(['"]?)(\w+)\1\s*=\s*\1\2\1/i,
    /\band\s+true\b/i,
    /\band\s+false\b/i,
    /\bsleep\s*\(/i,
    /\bbenchmark\s*\(/i,
    /\bwaitfor\s+delay/i,
    /;\s*\w+/,
    /information_schema/i,
    /mysql\./i,
    /\bxp_cmdshell/i,
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(where)) {
      throw new Error('WHERE clause contains potentially dangerous operation')
    }
  }
}
