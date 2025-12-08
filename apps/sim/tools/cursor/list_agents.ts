import type { ListAgentsParams, ListAgentsResponse } from '@/tools/cursor/types'
import type { ToolConfig } from '@/tools/types'

export const listAgentsTool: ToolConfig<ListAgentsParams, ListAgentsResponse> = {
  id: 'cursor_list_agents',
  name: 'Cursor List Agents',
  description: 'List all cloud agents for the authenticated user with optional pagination.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cursor API key',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of agents to return (default: 20, max: 100)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from previous response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.cursor.com/v0/agents')
      if (params.limit) url.searchParams.set('limit', String(params.limit))
      if (params.cursor) url.searchParams.set('cursor', params.cursor)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Basic ${Buffer.from(`${params.apiKey}:`).toString('base64')}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        content: `Found ${data.agents.length} agents`,
        metadata: {
          agents: data.agents,
          nextCursor: data.nextCursor,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable list of agents' },
    metadata: {
      type: 'object',
      description: 'Agent list metadata',
      properties: {
        agents: {
          type: 'array',
          description: 'Array of agent objects',
        },
        nextCursor: {
          type: 'string',
          description: 'Pagination cursor for next page',
          optional: true,
        },
      },
    },
  },
}
