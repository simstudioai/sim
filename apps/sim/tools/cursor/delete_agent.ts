import type { DeleteAgentParams, DeleteAgentResponse } from '@/tools/cursor/types'
import type { ToolConfig } from '@/tools/types'

export const deleteAgentTool: ToolConfig<DeleteAgentParams, DeleteAgentResponse> = {
  id: 'cursor_delete_agent',
  name: 'Cursor Delete Agent',
  description: 'Permanently delete a cloud agent. This action cannot be undone.',
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
    method: 'DELETE',
    headers: (params) => ({
      Authorization: `Basic ${Buffer.from(`${params.apiKey}:`).toString('base64')}`,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    const content = `Agent ${data.id} has been deleted`

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
