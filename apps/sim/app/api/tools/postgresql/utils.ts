import { Client } from 'pg'
import type { PostgresConnectionConfig } from '@/tools/postgresql/types'

export async function createPostgresConnection(config: PostgresConnectionConfig): Promise<Client> {
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    ssl:
      config.ssl === 'disabled'
        ? false
        : config.ssl === 'required'
          ? true
          : config.ssl === 'preferred'
            ? { rejectUnauthorized: false }
            : false,
    connectionTimeoutMillis: 10000, // 10 seconds
    query_timeout: 30000, // 30 seconds
  })

  try {
    await client.connect()
    return client
  } catch (error) {
    await client.end()
    throw error
  }
}

export async function executeQuery(
  client: Client,
  query: string,
  params: unknown[] = []
): Promise<{ rows: unknown[]; rowCount: number }> {
  const result = await client.query(query, params)
  return {
    rows: result.rows || [],
    rowCount: result.rowCount || 0,
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

  // Only allow specific statement types for execute endpoint
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
  // Handle schema.table format
  if (identifier.includes('.')) {
    const parts = identifier.split('.')
    return parts.map((part) => sanitizeSingleIdentifier(part)).join('.')
  }

  return sanitizeSingleIdentifier(identifier)
}

function sanitizeSingleIdentifier(identifier: string): string {
  // Remove any existing double quotes to prevent double-escaping
  const cleaned = identifier.replace(/"/g, '')

  // Validate identifier contains only safe characters
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleaned)) {
    throw new Error(
      `Invalid identifier: ${identifier}. Identifiers must start with a letter or underscore and contain only letters, numbers, and underscores.`
    )
  }

  // Wrap in double quotes for PostgreSQL
  return `"${cleaned}"`
}

export function buildInsertQuery(
  table: string,
  data: Record<string, unknown>
): {
  query: string
  values: unknown[]
} {
  const sanitizedTable = sanitizeIdentifier(table)
  const columns = Object.keys(data)
  const sanitizedColumns = columns.map((col) => sanitizeIdentifier(col))
  const placeholders = columns.map((_, index) => `$${index + 1}`)
  const values = columns.map((col) => data[col])

  const query = `INSERT INTO ${sanitizedTable} (${sanitizedColumns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`

  return { query, values }
}

export function buildUpdateQuery(
  table: string,
  data: Record<string, unknown>,
  where: string
): {
  query: string
  values: unknown[]
} {
  const sanitizedTable = sanitizeIdentifier(table)
  const columns = Object.keys(data)
  const sanitizedColumns = columns.map((col) => sanitizeIdentifier(col))
  const setClause = sanitizedColumns.map((col, index) => `${col} = $${index + 1}`).join(', ')
  const values = columns.map((col) => data[col])

  const query = `UPDATE ${sanitizedTable} SET ${setClause} WHERE ${where} RETURNING *`

  return { query, values }
}

export function buildDeleteQuery(
  table: string,
  where: string
): {
  query: string
  values: unknown[]
} {
  const sanitizedTable = sanitizeIdentifier(table)
  const query = `DELETE FROM ${sanitizedTable} WHERE ${where} RETURNING *`

  return { query, values: [] }
}
