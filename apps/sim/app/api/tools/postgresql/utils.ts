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

export interface IntrospectionResult {
  tables: Array<{
    name: string
    schema: string
    columns: Array<{
      name: string
      type: string
      nullable: boolean
      default: string | null
      isPrimaryKey: boolean
      isForeignKey: boolean
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
  schemas: string[]
}

export async function executeIntrospect(
  sql: any,
  schemaName = 'public'
): Promise<IntrospectionResult> {
  const schemasResult = await sql`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    ORDER BY schema_name
  `
  const schemas = schemasResult.map((row: { schema_name: string }) => row.schema_name)

  const tablesResult = await sql`
    SELECT table_name, table_schema
    FROM information_schema.tables
    WHERE table_schema = ${schemaName}
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `

  const tables = []

  for (const tableRow of tablesResult) {
    const tableName = tableRow.table_name
    const tableSchema = tableRow.table_schema

    const columnsResult = await sql`
      SELECT
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        c.udt_name
      FROM information_schema.columns c
      WHERE c.table_schema = ${tableSchema}
        AND c.table_name = ${tableName}
      ORDER BY c.ordinal_position
    `

    const pkResult = await sql`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = ${tableSchema}
        AND tc.table_name = ${tableName}
    `
    const primaryKeyColumns = pkResult.map((row: { column_name: string }) => row.column_name)

    const fkResult = await sql`
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = ${tableSchema}
        AND tc.table_name = ${tableName}
    `

    const foreignKeys = fkResult.map(
      (row: { column_name: string; foreign_table_name: string; foreign_column_name: string }) => ({
        column: row.column_name,
        referencesTable: row.foreign_table_name,
        referencesColumn: row.foreign_column_name,
      })
    )

    const fkColumnSet = new Set(foreignKeys.map((fk: { column: string }) => fk.column))

    const indexesResult = await sql`
      SELECT
        i.relname AS index_name,
        a.attname AS column_name,
        ix.indisunique AS is_unique
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE t.relkind = 'r'
        AND n.nspname = ${tableSchema}
        AND t.relname = ${tableName}
        AND NOT ix.indisprimary
      ORDER BY i.relname, a.attnum
    `

    const indexMap = new Map<string, { name: string; columns: string[]; unique: boolean }>()
    for (const row of indexesResult) {
      const indexName = row.index_name
      if (!indexMap.has(indexName)) {
        indexMap.set(indexName, {
          name: indexName,
          columns: [],
          unique: row.is_unique,
        })
      }
      indexMap.get(indexName)!.columns.push(row.column_name)
    }
    const indexes = Array.from(indexMap.values())

    const columns = columnsResult.map(
      (col: {
        column_name: string
        data_type: string
        is_nullable: string
        column_default: string | null
        udt_name: string
      }) => {
        const columnName = col.column_name
        const fk = foreignKeys.find((f: { column: string }) => f.column === columnName)

        return {
          name: columnName,
          type: col.data_type === 'USER-DEFINED' ? col.udt_name : col.data_type,
          nullable: col.is_nullable === 'YES',
          default: col.column_default,
          isPrimaryKey: primaryKeyColumns.includes(columnName),
          isForeignKey: fkColumnSet.has(columnName),
          ...(fk && {
            references: {
              table: fk.referencesTable,
              column: fk.referencesColumn,
            },
          }),
        }
      }
    )

    tables.push({
      name: tableName,
      schema: tableSchema,
      columns,
      primaryKey: primaryKeyColumns,
      foreignKeys,
      indexes,
    })
  }

  return { tables, schemas }
}
