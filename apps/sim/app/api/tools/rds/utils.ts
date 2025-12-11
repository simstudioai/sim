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
