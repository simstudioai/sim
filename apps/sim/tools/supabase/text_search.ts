import type { SupabaseTextSearchParams, SupabaseTextSearchResponse } from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const textSearchTool: ToolConfig<SupabaseTextSearchParams, SupabaseTextSearchResponse> = {
  id: 'supabase_text_search',
  name: 'Supabase Text Search',
  description: 'Perform full-text search on a Supabase table',
  version: '1.0',

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
      description: 'The name of the Supabase table to search',
    },
    column: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The column to search in',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query',
    },
    searchType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search type: plain, phrase, or websearch (default: websearch)',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language for text search configuration (default: english)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of rows to return',
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
      const searchType = params.searchType || 'websearch'
      const language = params.language || 'english'

      // Build the text search filter
      let url = `https://${params.projectId}.supabase.co/rest/v1/${params.table}?select=*`

      // Map search types to PostgREST operators
      const operatorMap: Record<string, string> = {
        plain: 'fts',
        phrase: 'phfts',
        websearch: 'wfts',
      }

      const operator = operatorMap[searchType] || 'wfts'

      // Add text search filter using PostgREST syntax
      url += `&${params.column}=${operator}(${language}).${encodeURIComponent(params.query)}`

      // Add limit if provided
      if (params.limit) {
        url += `&limit=${Number(params.limit)}`
      }

      return url
    },
    method: 'GET',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      throw new Error(`Failed to parse Supabase text search response: ${parseError}`)
    }

    if (!response.ok && data?.message) {
      const errorMessage = data.message

      if (errorMessage.includes('to_tsvector') && errorMessage.includes('does not exist')) {
        throw new Error(
          'Full-text search can only be performed on text columns. The selected column appears to be a non-text type (e.g., integer, boolean). Please select a text/varchar column or use a different operation.'
        )
      }

      if (errorMessage.includes('column') && errorMessage.includes('does not exist')) {
        throw new Error(`The specified column does not exist in the table. Error: ${errorMessage}`)
      }

      throw new Error(errorMessage)
    }

    const rowCount = Array.isArray(data) ? data.length : 0

    if (rowCount === 0) {
      return {
        success: true,
        output: {
          message: 'No results found matching the search query',
          results: data,
        },
        error: undefined,
      }
    }

    return {
      success: true,
      output: {
        message: `Successfully found ${rowCount} result${rowCount === 1 ? '' : 's'}`,
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: { type: 'array', description: 'Array of records matching the search query' },
  },
}
