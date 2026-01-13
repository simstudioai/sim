import type { GetAgentParams, GetAgentResponse } from '@/tools/cursor/types'
import type { ToolConfig } from '@/tools/types'

const getAgentBase = {
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
    url: (params: GetAgentParams) => `https://api.cursor.com/v0/agents/${params.agentId}`,
    method: 'GET',
    headers: (params: GetAgentParams) => ({
      Authorization: `Basic ${Buffer.from(`${params.apiKey}:`).toString('base64')}`,
    }),
  },
} satisfies Pick<ToolConfig<GetAgentParams, any>, 'params' | 'request'>

export const getAgentTool: ToolConfig<GetAgentParams, GetAgentResponse> = {
  id: 'cursor_get_agent',
  name: 'Cursor Get Agent',
  description: 'Retrieve the current status and results of a cloud agent.',
  version: '1.0.0',

  ...getAgentBase,

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

interface GetAgentV2Response {
  success: boolean
  output: {
    id: string
    name: string
    status: string
    source: Record<string, any>
    target: Record<string, any>
    summary?: string
    createdAt: string
  }
}

export const getAgentV2Tool: ToolConfig<GetAgentParams, GetAgentV2Response> = {
  ...getAgentBase,
  id: 'cursor_get_agent_v2',
  name: 'Cursor Get Agent',
  description:
    'Retrieve the current status and results of a cloud agent. Returns API-aligned fields only.',
  version: '2.0.0',
  transformResponse: async (response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id,
        name: data.name,
        status: data.status,
        source: data.source,
        target: data.target,
        summary: data.summary ?? null,
        createdAt: data.createdAt,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Agent ID' },
    name: { type: 'string', description: 'Agent name' },
    status: { type: 'string', description: 'Agent status' },
    source: { type: 'json', description: 'Source repository info' },
    target: { type: 'json', description: 'Target branch/PR info' },
    summary: { type: 'string', description: 'Agent summary', optional: true },
    createdAt: { type: 'string', description: 'Creation timestamp' },
  },
}
