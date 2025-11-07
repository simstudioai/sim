import type { ToolConfig } from '@/tools/types'
import type { ZepResponse } from '@/tools/zep/types'

// Get User Context Tool - Retrieve user context with mode (Zep v3)
export const zepGetContextTool: ToolConfig<any, ZepResponse> = {
  id: 'zep_get_context',
  name: 'Get User Context',
  description: 'Retrieve user context from a thread with summary or basic mode',
  version: '1.0.0',

  params: {
    threadId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Thread ID to get context from',
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
    const text = await response.text()

    if (!response.ok) {
      throw new Error(`Zep API error (${response.status}): ${text || response.statusText}`)
    }

    const data = JSON.parse(text.replace(/^\uFEFF/, '').trim())

    return {
      success: true,
      output: {
        context: data.context || data,
        facts: data.facts || [],
        entities: data.entities || [],
        summary: data.summary,
      },
    }
  },

  outputs: {
    context: {
      type: 'string',
      description: 'The context string (summary or basic)',
    },
    facts: {
      type: 'array',
      description: 'Extracted facts',
    },
    entities: {
      type: 'array',
      description: 'Extracted entities',
    },
    summary: {
      type: 'string',
      description: 'Conversation summary',
    },
  },
}
