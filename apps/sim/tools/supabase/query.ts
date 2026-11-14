import { validateDatabaseIdentifier } from '@/lib/core/security/input-validation'
import { SUPABASE_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { SupabaseQueryParams, SupabaseQueryResponse } from '@/tools/supabase/types'
import { supabaseBaseUrl } from '@/tools/supabase/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Converts an order-by input into PostgREST's `order` value. Accepts a
 * comma-separated list where each term is `column`, `column ASC|DESC`, or
 * already in PostgREST form (`column.desc`, `column.desc.nullslast`).
 * @see https://docs.postgrest.org/en/stable/references/api/tables_views.html#ordering
 */
function toPostgrestOrder(orderBy: string): string {
  return orderBy
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean)
    .map((term) => {
      const spaced = term.match(/^(.+?)\s+(asc|desc)$/i)
      if (spaced) return `${spaced[1].trim()}.${spaced[2].toLowerCase()}`
      if (/\.(asc|desc|nullsfirst|nullslast)$/i.test(term)) return term
      return `${term}.asc`
    })
    .join(',')
}

export const queryTool: ToolConfig<SupabaseQueryParams, SupabaseQueryResponse> = {
  id: 'supabase_query',
  name: 'Supabase Query',
  description: 'Query data from a Supabase table',
  version: '1.0.0',
  oauth: SUPABASE_CREDENTIAL_OAUTH,

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Supabase project ID (e.g., jdrkgepadsdopsntdlom)',
    },
    table: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the Supabase table to query',
    },
    schema: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Database schema to query from (default: public). Use this to access tables in other schemas.',
    },
    select: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Columns to return (comma-separated). Defaults to * (all columns)',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'PostgREST filter (e.g., "id=eq.123")',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Column(s) to order by, comma-separated (e.g., "created_at DESC" or "created_at.desc,name.asc")',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of rows to return',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of rows to skip (for pagination)',
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
      const tableValidation = validateDatabaseIdentifier(params.table, 'table')
      if (!tableValidation.isValid) throw new Error(tableValidation.error)
      const selectColumns = params.select?.trim() || '*'
      let url = `${supabaseBaseUrl(params.projectId)}/rest/v1/${encodeURIComponent(params.table)}?select=${encodeURIComponent(selectColumns)}`

      // Add filters if provided - using PostgREST syntax
      if (params.filter?.trim()) {
        url += `&${params.filter.trim()}`
      }

      const orderParam = params.orderBy ? toPostgrestOrder(params.orderBy) : ''
      if (orderParam) {
        url += `&order=${orderParam}`
      }

      // Add limit if provided
      if (params.limit !== undefined && params.limit !== null) {
        url += `&limit=${Number(params.limit)}`
      }

      // Add offset if provided
      if (params.offset !== undefined && params.offset !== null) {
        url += `&offset=${Number(params.offset)}`
      }

      return url
    },
    method: 'GET',
    headers: (params) => {
      const headers: Record<string, string> = {
        apikey: params.apiKey,
        Authorization: `Bearer ${params.apiKey}`,
      }
      if (params.schema) {
        headers['Accept-Profile'] = params.schema
      }
      return headers
    },
  },

  transformResponse: async (response: Response) => {
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      throw new Error(`Failed to parse Supabase response: ${parseError}`)
    }

    const rowCount = Array.isArray(data) ? data.length : 0

    if (rowCount === 0) {
      return {
        success: true,
        output: {
          message: 'No rows found matching the query criteria',
          results: data,
        },
        error: undefined,
      }
    }

    return {
      success: true,
      output: {
        message: `Successfully queried ${rowCount} row${rowCount === 1 ? '' : 's'} from Supabase`,
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: { type: 'array', description: 'Array of records returned from the query' },
  },
}
