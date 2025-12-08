import type { StopAgentParams, StopAgentResponse } from '@/tools/cursor/types'
import type { ToolConfig } from '@/tools/types'

export const stopAgentTool: ToolConfig<StopAgentParams, StopAgentResponse> = {
  id: 'cursor_stop_agent',
  name: 'Cursor Stop Agent',
  description: 'Stop a running cloud agent. This pauses the agent without deleting it.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cursor API key',
    },
    agentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique identifier for the cloud agent (e.g., bc_abc123)',
    },
  },

  request: {
    url: (params) => `https://api.cursor.com/v0/agents/${params.agentId}/stop`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Basic ${Buffer.from(`${params.apiKey}:`).toString('base64')}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const content = `Agent ${data.id} has been stopped`

    return {
      success: true,
      output: {
        content,
        metadata: {
          id: data.id,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Success message' },
    metadata: {
      type: 'object',
      description: 'Result metadata',
      properties: {
        id: { type: 'string', description: 'Agent ID' },
      },
    },
  },
}
