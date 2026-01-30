import { createLogger } from '@sim/logger'
import {
  INTROSPECT_TABLE_OUTPUT_PROPERTIES,
  type SupabaseColumnSchema,
  type SupabaseIntrospectParams,
  type SupabaseIntrospectResponse,
  type SupabaseTableSchema,
} from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('SupabaseIntrospect')

/**
 * SQL query to introspect database schema
 * This query retrieves all tables, columns, primary keys, foreign keys, and indexes
 */
const INTROSPECTION_SQL = `
WITH table_info AS (
  SELECT
    t.table_schema,
    t.table_name
  FROM information_schema.tables t
  WHERE t.table_type = 'BASE TABLE'
    AND t.table_schema NOT IN ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime', 'supabase_functions', 'supabase_migrations', 'extensions', 'graphql', 'graphql_public', 'pgsodium', 'pgsodium_masks', 'vault', 'pgbouncer', '_timescaledb_internal', '_timescaledb_config', '_timescaledb_catalog', '_timescaledb_cache')
),
columns_info AS (
  SELECT
    c.table_schema,
    c.table_name,
    c.column_name,
    c.data_type,
    c.is_nullable,
    c.column_default,
    c.ordinal_position
  FROM information_schema.columns c
  INNER JOIN table_info t ON c.table_schema = t.table_schema AND c.table_name = t.table_name
),
pk_info AS (
  SELECT
    tc.table_schema,
    tc.table_name,
    kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  WHERE tc.constraint_type = 'PRIMARY KEY'
),
fk_info AS (
  SELECT
    tc.table_schema,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY'
),
index_info AS (
  SELECT
    schemaname AS table_schema,
    tablename AS table_name,
    indexname AS index_name,
    CASE WHEN indexdef LIKE '%UNIQUE%' THEN true ELSE false END AS is_unique,
    indexdef
  FROM pg_indexes
  WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime', 'supabase_functions', 'supabase_migrations', 'extensions', 'graphql', 'graphql_public', 'pgsodium', 'pgsodium_masks', 'vault', 'pgbouncer', '_timescaledb_internal', '_timescaledb_config', '_timescaledb_catalog', '_timescaledb_cache')
)
SELECT json_build_object(
  'tables', (
    SELECT json_agg(
      json_build_object(
        'schema', t.table_schema,
        'name', t.table_name,
        'columns', (
          SELECT json_agg(
            json_build_object(
              'name', c.column_name,
              'type', c.data_type,
              'nullable', c.is_nullable = 'YES',
              'default', c.column_default,
              'isPrimaryKey', EXISTS (
                SELECT 1 FROM pk_info pk
                WHERE pk.table_schema = c.table_schema
                  AND pk.table_name = c.table_name
                  AND pk.column_name = c.column_name
              ),
              'isForeignKey', EXISTS (
                SELECT 1 FROM fk_info fk
                WHERE fk.table_schema = c.table_schema
                  AND fk.table_name = c.table_name
                  AND fk.column_name = c.column_name
              ),
              'references', (
                SELECT json_build_object('table', fk.foreign_table_name, 'column', fk.foreign_column_name)
                FROM fk_info fk
                WHERE fk.table_schema = c.table_schema
                  AND fk.table_name = c.table_name
                  AND fk.column_name = c.column_name
                LIMIT 1
              )
            )
            ORDER BY c.ordinal_position
          )
          FROM columns_info c
          WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name
        ),
        'primaryKey', (
          SELECT COALESCE(json_agg(pk.column_name), '[]'::json)
          FROM pk_info pk
          WHERE pk.table_schema = t.table_schema AND pk.table_name = t.table_name
        ),
        'foreignKeys', (
          SELECT COALESCE(json_agg(
            json_build_object(
              'column', fk.column_name,
              'referencesTable', fk.foreign_table_name,
              'referencesColumn', fk.foreign_column_name
            )
          ), '[]'::json)
          FROM fk_info fk
          WHERE fk.table_schema = t.table_schema AND fk.table_name = t.table_name
        ),
        'indexes', (
          SELECT COALESCE(json_agg(
            json_build_object(
              'name', idx.index_name,
              'unique', idx.is_unique,
              'definition', idx.indexdef
            )
          ), '[]'::json)
          FROM index_info idx
          WHERE idx.table_schema = t.table_schema AND idx.table_name = t.table_name
        )
      )
    )
    FROM table_info t
  ),
  'schemas', (
    SELECT COALESCE(json_agg(DISTINCT table_schema), '[]'::json)
    FROM table_info
  )
) AS result;
`

/**
 * Escapes a value for single-quoted SQL strings by doubling single quotes
 */
function escapeSqlString(value: string): string {
  if (!value || value.length > 63) {
    throw new Error(`Invalid value: ${value}`)
  }
  return value.replace(/'/g, "''")
}

/**
 * SQL query filtered by specific schema
 */
const getSchemaFilteredSQL = (schema: string) => {
  const safeSchema = escapeSqlString(schema)
  return `
WITH table_info AS (
  SELECT
    t.table_schema,
    t.table_name
  FROM information_schema.tables t
  WHERE t.table_type = 'BASE TABLE'
    AND t.table_schema = '${safeSchema}'
),
columns_info AS (
  SELECT
    c.table_schema,
    c.table_name,
    c.column_name,
    c.data_type,
    c.is_nullable,
    c.column_default,
    c.ordinal_position
  FROM information_schema.columns c
  INNER JOIN table_info t ON c.table_schema = t.table_schema AND c.table_name = t.table_name
),
pk_info AS (
  SELECT
    tc.table_schema,
    tc.table_name,
    kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  WHERE tc.constraint_type = 'PRIMARY KEY'
    AND tc.table_schema = '${safeSchema}'
),
fk_info AS (
  SELECT
    tc.table_schema,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = '${safeSchema}'
),
index_info AS (
  SELECT
    schemaname AS table_schema,
    tablename AS table_name,
    indexname AS index_name,
    CASE WHEN indexdef LIKE '%UNIQUE%' THEN true ELSE false END AS is_unique,
    indexdef
  FROM pg_indexes
  WHERE schemaname = '${safeSchema}'
)
SELECT json_build_object(
  'tables', (
    SELECT json_agg(
      json_build_object(
        'schema', t.table_schema,
        'name', t.table_name,
        'columns', (
          SELECT json_agg(
            json_build_object(
              'name', c.column_name,
              'type', c.data_type,
              'nullable', c.is_nullable = 'YES',
              'default', c.column_default,
              'isPrimaryKey', EXISTS (
                SELECT 1 FROM pk_info pk
                WHERE pk.table_schema = c.table_schema
                  AND pk.table_name = c.table_name
                  AND pk.column_name = c.column_name
              ),
              'isForeignKey', EXISTS (
                SELECT 1 FROM fk_info fk
                WHERE fk.table_schema = c.table_schema
                  AND fk.table_name = c.table_name
                  AND fk.column_name = c.column_name
              ),
              'references', (
                SELECT json_build_object('table', fk.foreign_table_name, 'column', fk.foreign_column_name)
                FROM fk_info fk
                WHERE fk.table_schema = c.table_schema
                  AND fk.table_name = c.table_name
                  AND fk.column_name = c.column_name
                LIMIT 1
              )
            )
            ORDER BY c.ordinal_position
          )
          FROM columns_info c
          WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name
        ),
        'primaryKey', (
          SELECT COALESCE(json_agg(pk.column_name), '[]'::json)
          FROM pk_info pk
          WHERE pk.table_schema = t.table_schema AND pk.table_name = t.table_name
        ),
        'foreignKeys', (
          SELECT COALESCE(json_agg(
            json_build_object(
              'column', fk.column_name,
              'referencesTable', fk.foreign_table_name,
              'referencesColumn', fk.foreign_column_name
            )
          ), '[]'::json)
          FROM fk_info fk
          WHERE fk.table_schema = t.table_schema AND fk.table_name = t.table_name
        ),
        'indexes', (
          SELECT COALESCE(json_agg(
            json_build_object(
              'name', idx.index_name,
              'unique', idx.is_unique,
              'definition', idx.indexdef
            )
          ), '[]'::json)
          FROM index_info idx
          WHERE idx.table_schema = t.table_schema AND idx.table_name = t.table_name
        )
      )
    )
    FROM table_info t
  ),
  'schemas', (
    SELECT COALESCE(json_agg(DISTINCT table_schema), '[]'::json)
    FROM table_info
  )
) AS result;
`
}

/**
 * Tool for introspecting Supabase database schema
 * Uses raw SQL execution via PostgREST to retrieve table structures
 */
export const introspectTool: ToolConfig<SupabaseIntrospectParams, SupabaseIntrospectResponse> = {
  id: 'supabase_introspect',
  name: 'Supabase Introspect',
  description:
    'Introspect Supabase database schema to get table structures, columns, and relationships',
  version: '1.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Supabase project ID (e.g., jdrkgepadsdopsntdlom)',
    },
    schema: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Database schema to introspect (defaults to all user schemas, commonly "public")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Supabase service role secret key',
    },
  },

  request: {
    url: (params) => {
      return `https://${params.projectId}.supabase.co/rest/v1/rpc/`
    },
    method: 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: () => ({}),
  },

  directExecution: async (
    params: SupabaseIntrospectParams
  ): Promise<SupabaseIntrospectResponse> => {
    const { apiKey, projectId, schema } = params

    try {
      const sqlQuery = schema ? getSchemaFilteredSQL(schema) : INTROSPECTION_SQL

      const response = await fetch(`https://${projectId}.supabase.co/rest/v1/rpc/`, {
        method: 'POST',
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          query: sqlQuery,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.warn('Direct RPC call failed, attempting alternative approach', {
          status: response.status,
        })

        const pgResponse = await fetch(`https://${projectId}.supabase.co/rest/v1/?select=*`, {
          method: 'GET',
          headers: {
            apikey: apiKey,
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/openapi+json',
          },
        })

        if (!pgResponse.ok) {
          throw new Error(`Failed to introspect database: ${errorText}`)
        }

        const openApiSpec = await pgResponse.json()
        const tables = parseOpenApiSpec(openApiSpec, schema)

        return {
          success: true,
          output: {
            message: `Successfully introspected ${tables.length} table(s) from database schema`,
            tables,
            schemas: [...new Set(tables.map((t) => t.schema))],
          },
        }
      }

      const data = await response.json()
      const result = Array.isArray(data) && data.length > 0 ? data[0].result : data.result || data

      const tables: SupabaseTableSchema[] = (result.tables || []).map((table: any) => ({
        name: table.name,
        schema: table.schema,
        columns: (table.columns || []).map((col: any) => ({
          name: col.name,
          type: col.type,
          nullable: col.nullable,
          default: col.default,
          isPrimaryKey: col.isPrimaryKey,
          isForeignKey: col.isForeignKey,
          references: col.references,
        })),
        primaryKey: table.primaryKey || [],
        foreignKeys: table.foreignKeys || [],
        indexes: (table.indexes || []).map((idx: any) => ({
          name: idx.name,
          columns: parseIndexColumns(idx.definition || ''),
          unique: idx.unique,
        })),
      }))

      return {
        success: true,
        output: {
          message: `Successfully introspected ${tables.length} table(s) from database`,
          tables,
          schemas: result.schemas || [],
        },
      }
    } catch (error) {
      logger.error('Supabase introspection failed', { error })
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      return {
        success: false,
        output: {
          message: 'Failed to introspect database schema',
          tables: [],
          schemas: [],
        },
        error: errorMessage,
      }
    }
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        message: 'Schema introspection completed',
        tables: data.tables || [],
        schemas: data.schemas || [],
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    tables: {
      type: 'array',
      description: 'Array of table schemas with columns, keys, and indexes',
      items: {
        type: 'object',
        properties: INTROSPECT_TABLE_OUTPUT_PROPERTIES,
      },
    },
    schemas: { type: 'array', description: 'List of schemas found in the database' },
  },
}

/**
 * Parse index definition to extract column names
 */
function parseIndexColumns(indexDef: string): string[] {
  const match = indexDef.match(/\(([^)]+)\)/)
  if (match) {
    return match[1].split(',').map((col) => col.trim().replace(/"/g, ''))
  }
  return []
}

/**
 * Parse OpenAPI spec to extract table schema information
 * This is a fallback method when direct SQL execution is not available
 */
function parseOpenApiSpec(spec: any, filterSchema?: string): SupabaseTableSchema[] {
  const tables: SupabaseTableSchema[] = []
  const definitions = spec.definitions || spec.components?.schemas || {}

  for (const [tableName, tableDef] of Object.entries(definitions)) {
    if (tableName.startsWith('_') || tableName === 'Error') continue

    const definition = tableDef as any
    const properties = definition.properties || {}
    const required = definition.required || []

    const columns: SupabaseColumnSchema[] = []
    const primaryKey: string[] = []
    const foreignKeys: Array<{
      column: string
      referencesTable: string
      referencesColumn: string
    }> = []

    for (const [colName, colDef] of Object.entries(properties)) {
      const col = colDef as any
      const isPK = col.description?.includes('primary key') || colName === 'id'
      const fkMatch = col.description?.match(/references\s+(\w+)\.(\w+)/)

      const column: SupabaseColumnSchema = {
        name: colName,
        type: col.format || col.type || 'unknown',
        nullable: !required.includes(colName),
        default: col.default || null,
        isPrimaryKey: isPK,
        isForeignKey: !!fkMatch,
      }

      if (fkMatch) {
        column.references = { table: fkMatch[1], column: fkMatch[2] }
        foreignKeys.push({
          column: colName,
          referencesTable: fkMatch[1],
          referencesColumn: fkMatch[2],
        })
      }

      if (isPK) {
        primaryKey.push(colName)
      }

      columns.push(column)
    }

    const schemaName = filterSchema || 'public'

    if (!filterSchema || schemaName === filterSchema) {
      tables.push({
        name: tableName,
        schema: schemaName,
        columns,
        primaryKey,
        foreignKeys,
        indexes: [],
      })
    }
  }

  return tables
}
