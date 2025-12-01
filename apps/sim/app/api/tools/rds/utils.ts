import {
  ExecuteStatementCommand,
  type ExecuteStatementCommandOutput,
  type Field,
  RDSDataClient,
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
  database: string,
  sql: string
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  const command = new ExecuteStatementCommand({
    resourceArn,
    secretArn,
    database,
    sql,
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
    // Handle array values recursively
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
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(query)) {
      return {
        isValid: false,
        error: `Query contains potentially dangerous operation: ${pattern.source}`,
      }
    }
  }

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

  // Use backticks for MySQL/Aurora MySQL compatibility, double quotes work for PostgreSQL
  return `\`${cleaned}\``
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

export async function executeInsert(
  client: RDSDataClient,
  resourceArn: string,
  secretArn: string,
  database: string,
  table: string,
  data: Record<string, unknown>
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  const sanitizedTable = sanitizeIdentifier(table)
  const columns = Object.keys(data)
  const sanitizedColumns = columns.map((col) => sanitizeIdentifier(col))
  const values = columns.map((col) => formatValue(data[col]))

  const sql = `INSERT INTO ${sanitizedTable} (${sanitizedColumns.join(', ')}) VALUES (${values.join(', ')})`

  return executeStatement(client, resourceArn, secretArn, database, sql)
}

export async function executeUpdate(
  client: RDSDataClient,
  resourceArn: string,
  secretArn: string,
  database: string,
  table: string,
  data: Record<string, unknown>,
  where: string
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  validateWhereClause(where)

  const sanitizedTable = sanitizeIdentifier(table)
  const columns = Object.keys(data)
  const sanitizedColumns = columns.map((col) => sanitizeIdentifier(col))
  const setClause = sanitizedColumns
    .map((col, index) => `${col} = ${formatValue(data[columns[index]])}`)
    .join(', ')

  const sql = `UPDATE ${sanitizedTable} SET ${setClause} WHERE ${where}`

  return executeStatement(client, resourceArn, secretArn, database, sql)
}

export async function executeDelete(
  client: RDSDataClient,
  resourceArn: string,
  secretArn: string,
  database: string,
  table: string,
  where: string
): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
  validateWhereClause(where)

  const sanitizedTable = sanitizeIdentifier(table)
  const sql = `DELETE FROM ${sanitizedTable} WHERE ${where}`

  return executeStatement(client, resourceArn, secretArn, database, sql)
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL'
  }
  if (typeof value === 'number') {
    return String(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE'
  }
  if (typeof value === 'string') {
    // Escape single quotes
    const escaped = value.replace(/'/g, "''")
    return `'${escaped}'`
  }
  if (typeof value === 'object') {
    const escaped = JSON.stringify(value).replace(/'/g, "''")
    return `'${escaped}'`
  }
  return `'${String(value)}'`
}
