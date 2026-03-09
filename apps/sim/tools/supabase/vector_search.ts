import type {
  SupabaseVectorSearchParams,
  SupabaseVectorSearchResponse,
} from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const vectorSearchTool: ToolConfig<
  SupabaseVectorSearchParams,
  SupabaseVectorSearchResponse
> = {
  id: 'supabase_vector_search',
  name: 'Supabase Vector Search',
  description: 'Perform similarity search using pgvector in a Supabase table',
  version: '1.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Supabase project ID (e.g., jdrkgepadsdopsntdlom)',
    },
    functionName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The name of the PostgreSQL function that performs vector search (e.g., match_documents)',
    },
    queryEmbedding: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'The query vector/embedding to search for similar items',
    },
    matchThreshold: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum similarity threshold (0-1), typically 0.7-0.9',
    },
    matchCount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (default: 10)',
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
      // Use RPC endpoint for calling PostgreSQL functions
      return `https://${params.projectId}.supabase.co/rest/v1/rpc/${params.functionName}`
    },
    method: 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      // Build the RPC call parameters
      const rpcParams: Record<string, any> = {
        query_embedding: params.queryEmbedding,
      }

      // Add optional parameters if provided
      if (params.matchThreshold !== undefined) {
        rpcParams.match_threshold = Number(params.matchThreshold)
      }

      if (params.matchCount !== undefined) {
        rpcParams.match_count = Number(params.matchCount)
      }

      return rpcParams
    },
  },

  transformResponse: async (response: Response) => {
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      throw new Error(`Failed to parse Supabase vector search response: ${parseError}`)
    }

    const resultCount = Array.isArray(data) ? data.length : 0

    if (resultCount === 0) {
      return {
        success: true,
        output: {
          message: 'No similar vectors found matching the search criteria',
          results: data,
        },
        error: undefined,
      }
    }

    return {
      success: true,
      output: {
        message: `Successfully found ${resultCount} similar vector${resultCount === 1 ? '' : 's'}`,
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: {
      type: 'array',
      description:
        'Array of records with similarity scores from the vector search. Each record includes a similarity field (0-1) indicating how similar it is to the query vector.',
    },
  },
}
