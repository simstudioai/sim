import type { GetAgentParams, GetAgentResponse } from '@/tools/cursor/types'
import type { ToolConfig } from '@/tools/types'

export const getAgentTool: ToolConfig<GetAgentParams, GetAgentResponse> = {
  id: 'cursor_get_agent',
  name: 'Cursor Get Agent',
  description: 'Retrieve the current status and results of a cloud agent.',
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
    url: (params) => `https://api.cursor.com/v0/agents/${params.agentId}`,
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
        content: `Agent "${data.name}" is ${data.status}`,
        metadata: data,
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable agent details' },
    metadata: {
      type: 'object',
      description: 'Agent metadata',
      properties: {
        id: { type: 'string', description: 'Agent ID' },
        name: { type: 'string', description: 'Agent name' },
        status: { type: 'string', description: 'Agent status' },
        source: { type: 'object', description: 'Source repository info' },
        target: { type: 'object', description: 'Target branch info' },
        summary: { type: 'string', description: 'Agent summary', optional: true },
        createdAt: { type: 'string', description: 'Creation timestamp' },
      },
    },
  },
}
