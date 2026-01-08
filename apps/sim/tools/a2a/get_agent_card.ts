/**
 * A2A Get Agent Card Tool
 *
 * Fetch the Agent Card (discovery document) for an A2A agent.
 */

import { createLogger } from '@sim/logger'
import type { AgentCard } from '@/lib/a2a/types'
import type { ToolConfig } from '@/tools/types'
import type { A2AGetAgentCardParams, A2AGetAgentCardResponse } from './types'

const logger = createLogger('A2AGetAgentCardTool')

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
    url: (params: A2AGetAgentCardParams) => params.agentUrl,
    method: 'GET',
    headers: (params: A2AGetAgentCardParams) => {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      }
      if (params.apiKey) {
        headers.Authorization = `Bearer ${params.apiKey}`
      }
      return headers
    },
  },

  transformResponse: async (response: Response) => {
    try {
      if (!response.ok) {
        return {
          success: false,
          output: {
            name: '',
            url: '',
            version: '',
          },
          error: `Failed to fetch agent card: ${response.status} ${response.statusText}`,
        }
      }

      const agentCard = (await response.json()) as AgentCard

      return {
        success: true,
        output: {
          name: agentCard.name,
          description: agentCard.description,
          url: agentCard.url,
          version: agentCard.version,
          capabilities: agentCard.capabilities,
          skills: agentCard.skills,
          authentication: agentCard.authentication,
          defaultInputModes: agentCard.defaultInputModes,
          defaultOutputModes: agentCard.defaultOutputModes,
        },
      }
    } catch (error) {
      logger.error('Error parsing Agent Card response:', error)
      return {
        success: false,
        output: {
          name: '',
          url: '',
          version: '',
        },
        error: error instanceof Error ? error.message : 'Failed to parse Agent Card',
      }
    }
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
    authentication: {
      type: 'object',
      description: 'Supported authentication schemes',
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
