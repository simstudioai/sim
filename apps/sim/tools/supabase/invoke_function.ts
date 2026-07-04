import type {
  SupabaseInvokeFunctionParams,
  SupabaseInvokeFunctionResponse,
} from '@/tools/supabase/types'
import { supabaseBaseUrl } from '@/tools/supabase/utils'
import type { HttpMethod, ToolConfig } from '@/tools/types'

const ALLOWED_METHODS = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

function resolveMethod(method?: string): HttpMethod {
  const normalized = (method || 'POST').toUpperCase() as HttpMethod
  return ALLOWED_METHODS.has(normalized) ? normalized : 'POST'
}

/**
 * Edge Function names are URL path segments and may contain letters, digits,
 * underscores, and hyphens (e.g. `hello-world`). Reject anything else to
 * prevent path traversal / injection.
 */
function validateFunctionName(name: string): string {
  const trimmed = name?.trim()
  if (!trimmed || !/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new Error(
      'Invalid function name: must contain only letters, digits, underscores, and hyphens'
    )
  }
  return trimmed
}

export const invokeFunctionTool: ToolConfig<
  SupabaseInvokeFunctionParams,
  SupabaseInvokeFunctionResponse
> = {
  id: 'supabase_invoke_function',
  name: 'Supabase Invoke Edge Function',
  description: 'Invoke a Supabase Edge Function over HTTP',
  version: '1.0.0',

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
      description: 'The name of the Edge Function to invoke (e.g., "hello-world")',
    },
    method: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTTP method to use: GET, POST, PUT, PATCH, or DELETE (default: POST)',
    },
    body: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Request payload to send to the function as a JSON object (ignored for GET)',
    },
    headers: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Additional request headers as a JSON object of header name to value',
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
      const functionName = validateFunctionName(params.functionName)
      return `${supabaseBaseUrl(params.projectId)}/functions/v1/${functionName}`
    },
    method: (params) => resolveMethod(params.method),
    headers: (params) => {
      const headers: Record<string, string> = {
        apikey: params.apiKey,
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      }
      if (params.headers && typeof params.headers === 'object' && !Array.isArray(params.headers)) {
        for (const [key, value] of Object.entries(params.headers)) {
          headers[key] = String(value)
        }
      }
      return headers
    },
    body: (params) => {
      if (resolveMethod(params.method) === 'GET') {
        return undefined
      }
      return params.body ?? {}
    },
  },

  /**
   * Only the success path is handled here — the tool executor throws on
   * non-OK responses before `transformResponse` runs, surfacing the Edge
   * Function's error body via the shared error extractor.
   */
  transformResponse: async (response: Response) => {
    const contentType = response.headers.get('content-type') || ''
    let results: unknown
    if (contentType.includes('application/json')) {
      try {
        results = await response.json()
      } catch (parseError) {
        throw new Error(`Failed to parse Supabase Edge Function response: ${parseError}`)
      }
    } else {
      results = await response.text()
    }

    return {
      success: true,
      output: {
        message: 'Successfully invoked Edge Function',
        results,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: { type: 'json', description: 'Response body returned by the Edge Function' },
  },
}
