import type { ToolConfig } from '@/tools/types'
import type { ZepResponse } from '@/tools/zep/types'

export const zepGetContextTool: ToolConfig<any, ZepResponse> = {
  id: 'zep_get_context',
  name: 'Get User Context',
  description: 'Retrieve user context from a thread with summary or basic mode',
  version: '1.0.0',

  params: {
    threadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Thread ID to get context from (e.g., "thread_abc123")',
    },
    mode: {
      type: 'string',
      required: false,
      default: 'summary',
      visibility: 'user-only',
      description: 'Context mode: "summary" (natural language) or "basic" (raw facts)',
    },
    minRating: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Minimum rating by which to filter relevant facts',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Zep API key',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      const mode = params.mode || 'summary'
      queryParams.append('mode', mode)
      if (params.minRating !== undefined)
        queryParams.append('minRating', String(Number(params.minRating)))
      return `https://api.getzep.com/api/v2/threads/${params.threadId}/context?${queryParams.toString()}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Api-Key ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Zep API error (${response.status}): ${error || response.statusText}`)
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        context: data.context,
      },
    }
  },

  outputs: {
    context: {
      type: 'string',
      description: 'The context string (summary or basic mode)',
    },
  },
}
