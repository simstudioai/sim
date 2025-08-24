import { Client } from 'pg'
import type { PostgresConnectionConfig } from '@/tools/postgresql/types'

export async function createPostgresConnection(config: PostgresConnectionConfig): Promise<Client> {
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    ssl: config.ssl === 'disable' ? false : config.ssl === 'require',
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
  params: any[] = []
): Promise<{ rows: any[]; rowCount: number }> {
  const result = await client.query(query, params)
  return {
    rows: result.rows || [],
    rowCount: result.rowCount || 0,
  }
}

export function sanitizeIdentifier(identifier: string): string {
  // Just return the identifier as-is, PostgreSQL handles quoting automatically when needed
  // This preserves schema.table format and avoids breaking valid identifiers
  return identifier
}

export function buildInsertQuery(
  table: string,
  data: Record<string, any>
): {
  query: string
  values: any[]
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
  data: Record<string, any>,
  whereClause: string
): {
  query: string
  values: any[]
} {
  const sanitizedTable = sanitizeIdentifier(table)
  const columns = Object.keys(data)
  const sanitizedColumns = columns.map((col) => sanitizeIdentifier(col))
  const setClause = sanitizedColumns.map((col, index) => `${col} = $${index + 1}`).join(', ')
  const values = columns.map((col) => data[col])

  const query = `UPDATE ${sanitizedTable} SET ${setClause} WHERE ${whereClause} RETURNING *`

  return { query, values }
}

export function buildDeleteQuery(table: string, whereClause: string): string {
  const sanitizedTable = sanitizeIdentifier(table)
  return `DELETE FROM ${sanitizedTable} WHERE ${whereClause} RETURNING *`
}
