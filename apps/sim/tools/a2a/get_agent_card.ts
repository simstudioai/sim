import type { A2AAgentCardResponse, A2AGetAgentCardParams } from '@/tools/a2a/types'
import type { ToolConfig } from '@/tools/types'

export const a2aGetAgentCardTool: ToolConfig<A2AGetAgentCardParams, A2AAgentCardResponse> = {
  id: 'a2a_get_agent_card',
  name: 'A2A Get Agent Card',
  description: 'Fetch the Agent Card (discovery document) for an external A2A agent.',
  version: '1.0.0',

  params: {
    agentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'The A2A agent endpoint URL',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API key for authentication (if required)',
    },
  },

  request: {
    url: '/api/tools/a2a/get-agent-card',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const body: Record<string, unknown> = { agentUrl: params.agentUrl }
      if (params.apiKey) body.apiKey = params.apiKey
      return body
    },
  },

  transformResponse: async (response: Response) => response.json(),

  outputs: {
    name: { type: 'string', description: 'Agent display name' },
    description: { type: 'string', description: 'Agent description' },
    url: { type: 'string', description: 'Agent endpoint URL' },
    version: { type: 'string', description: "The agent's own version" },
    protocolVersion: { type: 'string', description: 'A2A protocol version the agent exposes' },
    capabilities: {
      type: 'json',
      description: 'Agent capability flags',
      properties: {
        streaming: { type: 'boolean', description: 'Supports streaming responses' },
        pushNotifications: { type: 'boolean', description: 'Supports push notifications' },
        extendedAgentCard: { type: 'boolean', description: 'Provides an extended agent card' },
      },
    },
    skills: {
      type: 'array',
      description: 'Skills the agent can perform',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Skill identifier' },
          name: { type: 'string', description: 'Skill name' },
          description: { type: 'string', description: 'Skill description' },
        },
      },
    },
    defaultInputModes: {
      type: 'array',
      description: 'Default accepted input media types',
      items: { type: 'string' },
    },
    defaultOutputModes: {
      type: 'array',
      description: 'Default produced output media types',
      items: { type: 'string' },
    },
  },
}
