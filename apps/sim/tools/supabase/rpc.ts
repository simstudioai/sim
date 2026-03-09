import type { SupabaseRpcParams, SupabaseRpcResponse } from '@/tools/supabase/types'
import type { ToolConfig } from '@/tools/types'

export const rpcTool: ToolConfig<SupabaseRpcParams, SupabaseRpcResponse> = {
  id: 'supabase_rpc',
  name: 'Supabase RPC',
  description: 'Call a PostgreSQL function in Supabase',
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
      description: 'The name of the PostgreSQL function to call',
    },
    params: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parameters to pass to the function as a JSON object',
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
      return `https://${params.projectId}.supabase.co/rest/v1/rpc/${params.functionName}`
    },
    method: 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return params.params || {}
    },
  },

  transformResponse: async (response: Response) => {
    let data
    try {
      data = await response.json()
    } catch (parseError) {
      throw new Error(`Failed to parse Supabase RPC response: ${parseError}`)
    }

    return {
      success: true,
      output: {
        message: 'Successfully executed PostgreSQL function',
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: { type: 'json', description: 'Result returned from the function' },
  },
}
