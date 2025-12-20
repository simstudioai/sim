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
  const rowCount = result.count ?? result.length ?? 0
  return {
    rows: Array.isArray(result) ? result : [result],
    rowCount,
  }
}

export function validateQuery(query: string): { isValid: boolean; error?: string } {
  const trimmedQuery = query.trim().toLowerCase()

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
    /load_file\s*\(/i,
    /pg_read_file/i,
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
    /\bwaitfor\s+delay/i,
    /\bpg_sleep\s*\(/i,
    /\bbenchmark\s*\(/i,
    // Stacked queries (any statement after semicolon)
    /;\s*\w+/,
    // Information schema / system catalog queries
    /information_schema/i,
    /pg_catalog/i,
    // System functions and procedures
    /\bxp_cmdshell/i,
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

  const rowCount = result.count ?? result.length ?? 0
  return {
    rows: Array.isArray(result) ? result : [result],
    rowCount,
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

  const rowCount = result.count ?? result.length ?? 0
  return {
    rows: Array.isArray(result) ? result : [result],
    rowCount,
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

  const rowCount = result.count ?? result.length ?? 0
  return {
    rows: Array.isArray(result) ? result : [result],
    rowCount,
  }
}
