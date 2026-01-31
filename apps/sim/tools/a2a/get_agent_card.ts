import type { A2AGetAgentCardParams, A2AGetAgentCardResponse } from '@/tools/a2a/types'
import { A2A_OUTPUT_PROPERTIES } from '@/tools/a2a/types'
import type { ToolConfig } from '@/tools/types'

export const a2aGetAgentCardTool: ToolConfig<A2AGetAgentCardParams, A2AGetAgentCardResponse> = {
  id: 'a2a_get_agent_card',
  name: 'A2A Get Agent Card',
  description: 'Fetch the Agent Card (discovery document) for an A2A agent.',
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
      visibility: 'user-only',
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
    name: A2A_OUTPUT_PROPERTIES.agentName,
    description: A2A_OUTPUT_PROPERTIES.agentDescription,
    url: A2A_OUTPUT_PROPERTIES.agentEndpoint,
    provider: A2A_OUTPUT_PROPERTIES.agentProvider,
    capabilities: A2A_OUTPUT_PROPERTIES.agentCapabilities,
    skills: A2A_OUTPUT_PROPERTIES.agentSkills,
    version: A2A_OUTPUT_PROPERTIES.version,
    defaultInputModes: A2A_OUTPUT_PROPERTIES.defaultInputModes,
    defaultOutputModes: A2A_OUTPUT_PROPERTIES.defaultOutputModes,
  },
}
