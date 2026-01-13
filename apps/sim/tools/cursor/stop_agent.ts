import type { StopAgentParams, StopAgentResponse } from '@/tools/cursor/types'
import type { ToolConfig } from '@/tools/types'

const stopAgentBase = {
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
    url: (params: StopAgentParams) => `https://api.cursor.com/v0/agents/${params.agentId}/stop`,
    method: 'POST',
    headers: (params: StopAgentParams) => ({
      Authorization: `Basic ${Buffer.from(`${params.apiKey}:`).toString('base64')}`,
    }),
  },
} satisfies Pick<ToolConfig<StopAgentParams, any>, 'params' | 'request'>

export const stopAgentTool: ToolConfig<StopAgentParams, StopAgentResponse> = {
  id: 'cursor_stop_agent',
  name: 'Cursor Stop Agent',
  description: 'Stop a running cloud agent. This pauses the agent without deleting it.',
  version: '1.0.0',

  ...stopAgentBase,

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

interface StopAgentV2Response {
  success: boolean
  output: {
    id: string
  }
}

export const stopAgentV2Tool: ToolConfig<StopAgentParams, StopAgentV2Response> = {
  ...stopAgentBase,
  id: 'cursor_stop_agent_v2',
  name: 'Cursor Stop Agent',
  description: 'Stop a running cloud agent. Returns API-aligned fields only.',
  version: '2.0.0',
  transformResponse: async (response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Agent ID' },
  },
}
