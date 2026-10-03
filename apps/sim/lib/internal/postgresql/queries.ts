import type { PostgresClient } from '@/lib/internal/postgresql/client'
import { executePostgresQuery } from '@/lib/internal/postgresql/client'

export interface PostgresRowsResult {
  rows: unknown[]
  rowCount: number
}

export interface PostgresIntrospectionResult {
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

interface SchemaRow {
  schema_name: string
}

interface TableRow {
  table_name: string
  table_schema: string
}

interface ColumnRow {
  column_name: string
  data_type: string
  is_nullable: string
  column_default: string | null
  udt_name: string
}

interface PrimaryKeyRow {
  column_name: string
}

interface ForeignKeyRow {
  column_name: string
  foreign_table_name: string
  foreign_column_name: string
}

interface IndexRow {
  index_name: string
  column_name: string
  is_unique: boolean
}

export async function queryPostgres(
  client: PostgresClient,
  query: string,
  params: unknown[] = [],
  signal?: AbortSignal
): Promise<PostgresRowsResult> {
  type PostgresParameters = NonNullable<Parameters<PostgresClient['unsafe']>[1]>
  const result = await executePostgresQuery(
    client.unsafe(query, params as PostgresParameters),
    signal
  )
  return {
    rows: result,
    rowCount: result.count ?? result.length ?? 0,
  }
}

export function validatePostgresQuery(query: string): { isValid: boolean; error?: string } {
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

export function sanitizePostgresIdentifier(identifier: string): string {
  if (identifier.includes('.')) {
    return identifier
      .split('.')
      .map((part) => sanitizeSingleIdentifier(part))
      .join('.')
  }

  return sanitizeSingleIdentifier(identifier)
}

export async function insertPostgresRows(
  client: PostgresClient,
  table: string,
  data: Record<string, unknown>,
  signal?: AbortSignal
): Promise<PostgresRowsResult> {
  const sanitizedTable = sanitizePostgresIdentifier(table)
  const columns = Object.keys(data)
  const sanitizedColumns = columns.map((column) => sanitizePostgresIdentifier(column))
  const placeholders = columns.map((_, index) => `$${index + 1}`)
  const values = columns.map((column) => data[column])
  const query = `INSERT INTO ${sanitizedTable} (${sanitizedColumns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`

  return queryPostgres(client, query, values, signal)
}

export async function updatePostgresRows(
  client: PostgresClient,
  table: string,
  data: Record<string, unknown>,
  where: string,
  signal?: AbortSignal
): Promise<PostgresRowsResult> {
  validateWhereClause(where)

  const sanitizedTable = sanitizePostgresIdentifier(table)
  const columns = Object.keys(data)
  const sanitizedColumns = columns.map((column) => sanitizePostgresIdentifier(column))
  const setClause = sanitizedColumns.map((column, index) => `${column} = $${index + 1}`).join(', ')
  const values = columns.map((column) => data[column])
  const query = `UPDATE ${sanitizedTable} SET ${setClause} WHERE ${where} RETURNING *`

  return queryPostgres(client, query, values, signal)
}

export async function deletePostgresRows(
  client: PostgresClient,
  table: string,
  where: string,
  signal?: AbortSignal
): Promise<PostgresRowsResult> {
  validateWhereClause(where)

  const sanitizedTable = sanitizePostgresIdentifier(table)
  const query = `DELETE FROM ${sanitizedTable} WHERE ${where} RETURNING *`

  return queryPostgres(client, query, [], signal)
}

export async function introspectPostgresSchema(
  client: PostgresClient,
  schemaName = 'public',
  signal?: AbortSignal
): Promise<PostgresIntrospectionResult> {
  const schemasResult = await executePostgresQuery(
    client<SchemaRow[]>`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      ORDER BY schema_name
    `,
    signal
  )
  const schemas = schemasResult.map((row) => row.schema_name)

  const tablesResult = await executePostgresQuery(
    client<TableRow[]>`
      SELECT table_name, table_schema
      FROM information_schema.tables
      WHERE table_schema = ${schemaName}
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `,
    signal
  )

  const tables: PostgresIntrospectionResult['tables'] = []

  for (const tableRow of tablesResult) {
    signal?.throwIfAborted()
    const tableName = tableRow.table_name
    const tableSchema = tableRow.table_schema

    const columnsResult = await executePostgresQuery(
      client<ColumnRow[]>`
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
      `,
      signal
    )

    const primaryKeyResult = await executePostgresQuery(
      client<PrimaryKeyRow[]>`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = ${tableSchema}
          AND tc.table_name = ${tableName}
      `,
      signal
    )
    const primaryKey = primaryKeyResult.map((row) => row.column_name)

    const foreignKeyResult = await executePostgresQuery(
      client<ForeignKeyRow[]>`
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
      `,
      signal
    )
    const foreignKeys = foreignKeyResult.map((row) => ({
      column: row.column_name,
      referencesTable: row.foreign_table_name,
      referencesColumn: row.foreign_column_name,
    }))
    const foreignKeyColumns = new Set(foreignKeys.map((foreignKey) => foreignKey.column))

    const indexesResult = await executePostgresQuery(
      client<IndexRow[]>`
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
      `,
      signal
    )

    const indexesByName = new Map<string, { name: string; columns: string[]; unique: boolean }>()
    for (const row of indexesResult) {
      const index = indexesByName.get(row.index_name) ?? {
        name: row.index_name,
        columns: [],
        unique: row.is_unique,
      }
      index.columns.push(row.column_name)
      indexesByName.set(row.index_name, index)
    }

    const columns = columnsResult.map((column) => {
      const foreignKey = foreignKeys.find((candidate) => candidate.column === column.column_name)
      return {
        name: column.column_name,
        type: column.data_type === 'USER-DEFINED' ? column.udt_name : column.data_type,
        nullable: column.is_nullable === 'YES',
        default: column.column_default,
        isPrimaryKey: primaryKey.includes(column.column_name),
        isForeignKey: foreignKeyColumns.has(column.column_name),
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
      schema: tableSchema,
      columns,
      primaryKey,
      foreignKeys,
      indexes: Array.from(indexesByName.values()),
    })
  }

  return { tables, schemas }
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

function validateWhereClause(where: string): void {
  const dangerousPatterns = [
    /;\s*(drop|delete|insert|update|create|alter|grant|revoke)/i,
    /union\s+(all\s+)?select/i,
    /into\s+outfile/i,
    /load_file\s*\(/i,
    /pg_read_file/i,
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
    /\bwaitfor\s+delay/i,
    /\bpg_sleep\s*\(/i,
    /\bbenchmark\s*\(/i,
    /;\s*\w+/,
    /information_schema/i,
    /pg_catalog/i,
    /\bxp_cmdshell/i,
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(where)) {
      throw new Error('WHERE clause contains potentially dangerous operation')
    }
  }
}
