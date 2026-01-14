import type { ToolConfig } from '@/tools/types'
import type { A2AGetAgentCardParams, A2AGetAgentCardResponse } from './types'

export const a2aGetAgentCardTool: ToolConfig<A2AGetAgentCardParams, A2AGetAgentCardResponse> = {
  id: 'a2a_get_agent_card',
  name: 'A2A Get Agent Card',
  description: 'Fetch the Agent Card (discovery document) for an A2A agent.',
  version: '1.0.0',

  params: {
    agentUrl: {
      type: 'string',
      required: true,
      description: 'The A2A agent endpoint URL',
    },
    apiKey: {
      type: 'string',
      description: 'API key for authentication (if required)',
    },
  },

  request: {
    url: '/api/tools/a2a/get-agent-card',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, string> = {
        agentUrl: params.agentUrl,
      }
      if (params.apiKey) body.apiKey = params.apiKey
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return data
  },

  outputs: {
    name: {
      type: 'string',
      description: 'Agent name',
    },
    description: {
      type: 'string',
      description: 'Agent description',
    },
    url: {
      type: 'string',
      description: 'Agent endpoint URL',
    },
    version: {
      type: 'string',
      description: 'Agent version',
    },
    capabilities: {
      type: 'object',
      description: 'Agent capabilities (streaming, pushNotifications, etc.)',
    },
    skills: {
      type: 'array',
      description: 'Skills the agent can perform',
    },
    defaultInputModes: {
      type: 'array',
      description: 'Default input modes (text, file, data)',
    },
    defaultOutputModes: {
      type: 'array',
      description: 'Default output modes (text, file, data)',
    },
  },
}
