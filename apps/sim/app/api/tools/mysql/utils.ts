import mysql from 'mysql2/promise'

export interface MySQLConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  ssl?: string
}

export async function createMySQLConnection(config: MySQLConnectionConfig) {
  const connectionConfig: mysql.ConnectionOptions = {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
  }

  if (config.ssl === 'required') {
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

  const dangerousPatterns = [
    /drop\s+database/i,
    /drop\s+schema/i,
    /drop\s+user/i,
    /create\s+user/i,
    /grant\s+/i,
    /revoke\s+/i,
    /alter\s+user/i,
    /set\s+global/i,
    /set\s+session/i,
    /load\s+data/i,
    /into\s+outfile/i,
    /into\s+dumpfile/i,
    /load_file\s*\(/i,
    /system\s+/i,
    /exec\s+/i,
    /execute\s+immediate/i,
    /xp_cmdshell/i,
    /sp_configure/i,
    /information_schema\.tables/i,
    /mysql\.user/i,
    /mysql\.db/i,
    /mysql\.host/i,
    /performance_schema/i,
    /sys\./i,
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(query)) {
      return {
        isValid: false,
        error: `Query contains potentially dangerous operation: ${pattern.source}`,
      }
    }
  }

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

function validateWhereClause(where: string): void {
  const dangerousPatterns = [
    /;\s*(drop|delete|insert|update|create|alter|grant|revoke)/i,
    /union\s+select/i,
    /into\s+outfile/i,
    /load_file/i,
    /--/,
    /\/\*/,
    /\*\//,
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
