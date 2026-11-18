import { SUPABASE_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
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
 * header) rather than a live `information_schema` query. PostgREST marks
 * primary-key columns with `<pk/>` and foreign-key columns with
 * `<fk table='t' column='c'/>` in each column's description, which is how
 * keys are detected. Index information is not available via this API at
 * all. `nullable` is best-effort: PostgREST only lists a column under
 * `required` when it's NOT NULL *and* has no default, so a NOT NULL column
 * with a default is reported as nullable.
 */
export const introspectTool: ToolConfig<SupabaseIntrospectParams, SupabaseIntrospectResponse> = {
  id: 'supabase_introspect',
  name: 'Supabase Introspect',
  description:
    'Introspect Supabase database schema from its OpenAPI spec to get table and column structures, primary keys, and foreign keys',
  version: '1.0.0',
  oauth: SUPABASE_CREDENTIAL_OAUTH,

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
    url: (params) => `${supabaseBaseUrl(params.projectId)}/rest/v1/`,
    method: 'GET',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/openapi+json',
      ...(params.schema ? { 'Accept-Profile': params.schema } : {}),
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
 * Keys come from the markers PostgREST appends to column descriptions
 * (`<pk/>`, `<fk table='t' column='c'/>`); a `references table.column` SQL
 * comment is also honored for foreign keys. `indexes` is always empty:
 * index definitions are not part of the OpenAPI spec.
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
      const description = typeof col.description === 'string' ? col.description : ''
      const isPK = description.includes('<pk/>')
      const fkMatch =
        description.match(/<fk table='([^']+)' column='([^']+)'\/>/) ??
        description.match(/references\s+(\w+)\.(\w+)/)

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

    tables.push({
      name: tableName,
      // The OpenAPI spec doesn't map tables to schemas, so this can only
      // reflect the schema that was actually requested (or "public" when
      // introspecting the default schema) — not necessarily the table's
      // true schema in a multi-schema database.
      schema: filterSchema || 'public',
      columns,
      primaryKey,
      foreignKeys,
      indexes: [],
    })
  }

  return tables
}
