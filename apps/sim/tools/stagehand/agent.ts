import { createLogger } from '@/lib/logs/console/logger'
import type { StagehandAgentParams, StagehandAgentResponse } from '@/tools/stagehand/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('StagehandAgentTool')

export const agentTool: ToolConfig<StagehandAgentParams, StagehandAgentResponse> = {
  id: 'stagehand_agent',
  name: 'Stagehand Agent',
  description: 'Run an autonomous web agent to complete tasks and extract structured data',
  version: '1.0.0',

  params: {
    startUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL of the webpage to start the agent on',
    },
    task: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The task to complete or goal to achieve on the website',
    },
    variables: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description:
        'Optional variables to substitute in the task (format: {key: value}). Reference in task using %key%',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'OpenAI API key for agent execution (required by Stagehand)',
    },
    outputSchema: {
      type: 'json',
      required: false,
      visibility: 'user-only',
      description: 'Optional JSON schema defining the structure of data the agent should return',
    },
  },

  request: {
    url: '/api/tools/stagehand/agent',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      let startUrl = params.startUrl
      if (startUrl && !startUrl.match(/^https?:\/\//i)) {
        startUrl = `https://${startUrl.trim()}`
        logger.info(`Normalized URL from ${params.startUrl} to ${startUrl}`)
      }

      return {
        task: params.task,
        startUrl: startUrl,
        outputSchema: params.outputSchema,
        variables: params.variables,
        apiKey: params.apiKey,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        agentResult: data.agentResult,
        structuredOutput: data.structuredOutput || {},
      },
    }
  },

  outputs: {
    agentResult: {
      type: 'object',
      description: 'Result from the Stagehand agent execution',
      properties: {
        success: { type: 'boolean', description: 'Whether the agent task completed successfully' },
        completed: { type: 'boolean', description: 'Whether the task was fully completed' },
        message: { type: 'string', description: 'Status message or final result' },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'Type of action performed' },
              params: { type: 'object', description: 'Parameters used for the action' },
              result: { type: 'object', description: 'Result of the action' },
            },
          },
          description: 'List of actions performed by the agent',
        },
      },
    },
    structuredOutput: {
      type: 'object',
      description: 'Extracted data matching the provided output schema',
    },
  },
}
