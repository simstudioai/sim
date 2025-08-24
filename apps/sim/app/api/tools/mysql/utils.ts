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
  const sslConfig = config.ssl === 'disabled' ? false : config.ssl === 'required' ? true : undefined

  return mysql.createConnection({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    ssl: sslConfig,
  })
}

export async function executeQuery(connection: mysql.Connection, query: string, values?: any[]) {
  const [rows, fields] = await connection.execute(query, values)

  if (Array.isArray(rows)) {
    return {
      rows: rows as any[],
      rowCount: rows.length,
      fields,
    }
  }

  return {
    rows: [],
    rowCount: (rows as any).affectedRows || 0,
    fields,
  }
}

export function buildInsertQuery(table: string, data: Record<string, any>) {
  const sanitizedTable = sanitizeIdentifier(table)
  const columns = Object.keys(data)
  const values = Object.values(data)
  const placeholders = columns.map(() => '?').join(', ')

  const query = `INSERT INTO ${sanitizedTable} (${columns.map(sanitizeIdentifier).join(', ')}) VALUES (${placeholders})`

  return { query, values }
}

export function buildUpdateQuery(table: string, data: Record<string, any>, where: string) {
  const sanitizedTable = sanitizeIdentifier(table)
  const columns = Object.keys(data)
  const values = Object.values(data)

  const setClause = columns.map((col) => `${sanitizeIdentifier(col)} = ?`).join(', ')
  const query = `UPDATE ${sanitizedTable} SET ${setClause} WHERE ${where}`

  return { query, values }
}

export function buildDeleteQuery(table: string, where: string) {
  const sanitizedTable = sanitizeIdentifier(table)
  const query = `DELETE FROM ${sanitizedTable} WHERE ${where}`

  return { query, values: [] }
}

export function sanitizeIdentifier(identifier: string): string {
  return identifier
}
