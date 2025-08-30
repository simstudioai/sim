import postgres from 'postgres'
import type { PostgresConnectionConfig } from '@/tools/postgresql/types'

export function createPostgresConnection(config: PostgresConnectionConfig) {
  const sslConfig =
    config.ssl === 'disabled'
      ? false
      : config.ssl === 'required'
        ? 'require'
        : config.ssl === 'preferred'
          ? 'prefer'
          : 'require'

  const sql = postgres({
    host: config.host,
    port: config.port,
    database: config.database,
    username: config.username,
    password: config.password,
    ssl: sslConfig,
    connect_timeout: 10, // 10 seconds
    idle_timeout: 20, // 20 seconds
    max_lifetime: 60 * 30, // 30 minutes
    max: 1, // Single connection for tool usage
  })

  return sql
}

export async function executeQuery(
  sql: any,
  query: string,
  params: unknown[] = []
): Promise<{ rows: unknown[]; rowCount: number }> {
  const result = await sql.unsafe(query, params)
  return {
    rows: Array.isArray(result) ? result : [result],
    rowCount: Array.isArray(result) ? result.length : result ? 1 : 0,
  }
}

export function validateQuery(query: string): { isValid: boolean; error?: string } {
  const trimmedQuery = query.trim().toLowerCase()

  // Block dangerous SQL operations
  const dangerousPatterns = [
    /drop\s+database/i,
    /drop\s+schema/i,
    /drop\s+user/i,
    /create\s+user/i,
    /create\s+role/i,
    /grant\s+/i,
    /revoke\s+/i,
    /alter\s+user/i,
    /alter\s+role/i,
    /set\s+role/i,
    /reset\s+role/i,
    /copy\s+.*from/i,
    /copy\s+.*to/i,
    /lo_import/i,
    /lo_export/i,
    /pg_read_file/i,
    /pg_write_file/i,
    /pg_ls_dir/i,
    /information_schema\.tables/i,
    /pg_catalog/i,
    /pg_user/i,
    /pg_shadow/i,
    /pg_roles/i,
    /pg_authid/i,
    /pg_stat_activity/i,
    /dblink/i,
    /\\\\copy/i,
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(query)) {
      return {
        isValid: false,
        error: `Query contains potentially dangerous operation: ${pattern.source}`,
      }
    }
  }

  const allowedStatements = /^(select|insert|update|delete|with|explain|analyze|show)\s+/i
  if (!allowedStatements.test(trimmedQuery)) {
    return {
      isValid: false,
      error:
        'Only SELECT, INSERT, UPDATE, DELETE, WITH, EXPLAIN, ANALYZE, and SHOW statements are allowed',
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

function sanitizeSingleIdentifier(identifier: string): string {
  const cleaned = identifier.replace(/"/g, '')

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleaned)) {
    throw new Error(
      `Invalid identifier: ${identifier}. Identifiers must start with a letter or underscore and contain only letters, numbers, and underscores.`
    )
  }

  return `"${cleaned}"`
}

export async function executeInsert(
  sql: any,
  table: string,
  data: Record<string, unknown>
): Promise<{ rows: unknown[]; rowCount: number }> {
  const sanitizedTable = sanitizeIdentifier(table)
  const columns = Object.keys(data)
  const sanitizedColumns = columns.map((col) => sanitizeIdentifier(col))
  const placeholders = columns.map((_, index) => `$${index + 1}`)
  const values = columns.map((col) => data[col])

  const query = `INSERT INTO ${sanitizedTable} (${sanitizedColumns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`
  const result = await sql.unsafe(query, values)

  return {
    rows: Array.isArray(result) ? result : [result],
    rowCount: Array.isArray(result) ? result.length : result ? 1 : 0,
  }
}

export async function executeUpdate(
  sql: any,
  table: string,
  data: Record<string, unknown>,
  where: string
): Promise<{ rows: unknown[]; rowCount: number }> {
  validateWhereClause(where)

  const sanitizedTable = sanitizeIdentifier(table)
  const columns = Object.keys(data)
  const sanitizedColumns = columns.map((col) => sanitizeIdentifier(col))
  const setClause = sanitizedColumns.map((col, index) => `${col} = $${index + 1}`).join(', ')
  const values = columns.map((col) => data[col])

  const query = `UPDATE ${sanitizedTable} SET ${setClause} WHERE ${where} RETURNING *`
  const result = await sql.unsafe(query, values)

  return {
    rows: Array.isArray(result) ? result : [result],
    rowCount: Array.isArray(result) ? result.length : result ? 1 : 0,
  }
}

export async function executeDelete(
  sql: any,
  table: string,
  where: string
): Promise<{ rows: unknown[]; rowCount: number }> {
  validateWhereClause(where)

  const sanitizedTable = sanitizeIdentifier(table)
  const query = `DELETE FROM ${sanitizedTable} WHERE ${where} RETURNING *`
  const result = await sql.unsafe(query, [])

  return {
    rows: Array.isArray(result) ? result : [result],
    rowCount: Array.isArray(result) ? result.length : result ? 1 : 0,
  }
}
