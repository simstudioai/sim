import {
  INTROSPECT_TABLE_OUTPUT_PROPERTIES,
  type SupabaseColumnSchema,
  type SupabaseIntrospectParams,
  type SupabaseIntrospectResponse,
  type SupabaseTableSchema,
} from '@/tools/supabase/types'
import { supabaseBaseUrl } from '@/tools/supabase/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Tool for introspecting Supabase database schema.
 *
 * PostgREST (which powers `/rest/v1`) has no generic "run arbitrary SQL"
 * endpoint, so schema introspection is derived from the project's
 * auto-generated OpenAPI spec (`GET /rest/v1/` with an OpenAPI `Accept`
 * header) rather than a live `information_schema` query. Primary-key
 * detection is a best-effort naming heuristic (`id` column), and
 * foreign-key detection only succeeds if the table owner has added a
 * matching `references table.column` SQL comment — the OpenAPI spec does
 * not expose constraint metadata directly. Index information is not
 * available via this API at all.
 */
export const introspectTool: ToolConfig<SupabaseIntrospectParams, SupabaseIntrospectResponse> = {
  id: 'supabase_introspect',
  name: 'Supabase Introspect',
  description:
    'Introspect Supabase database schema from its OpenAPI spec to get table and column structures (best-effort primary/foreign key detection)',
  version: '1.0.0',

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
    url: (params) => `${supabaseBaseUrl(params.projectId)}/rest/v1/?select=*`,
    method: 'GET',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/openapi+json',
    }),
  },

  transformResponse: async (response: Response, params?: SupabaseIntrospectParams) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to introspect database: ${errorText}`)
    }

    const openApiSpec = await response.json()
    const tables = parseOpenApiSpec(openApiSpec, params?.schema)

    return {
      success: true,
      output: {
        message: `Successfully introspected ${tables.length} table(s) from database schema`,
        tables,
        schemas: [...new Set(tables.map((t) => t.schema))],
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
 * Parse a PostgREST-generated OpenAPI spec into table schemas.
 *
 * `isPrimaryKey` is a naming heuristic (`id` column) — PostgREST does not
 * expose real constraint metadata in the spec. `isForeignKey`/`references`
 * only populate when the table owner has added a `references table.column`
 * SQL comment on the column. `indexes` is always empty: index definitions
 * are not part of the OpenAPI spec.
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
      const isPK = colName === 'id'
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
