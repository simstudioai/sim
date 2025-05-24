import { createLogger } from '@/lib/logs/console-logger'
import { ToolConfig } from '../types'
import { StagehandAgentParams, StagehandAgentResponse } from './types'

const logger = createLogger('StagehandAgentTool')

export const agentTool: ToolConfig<StagehandAgentParams, StagehandAgentResponse> = {
  id: 'stagehand_agent',
  name: 'Stagehand Agent',
  description: 'Run an autonomous web agent to complete tasks and extract structured data',
  version: '1.0.0',

  // Define the input parameters
  params: {
    task: {
      type: 'string',
      required: true,
      description: 'The task to complete or goal to achieve on the website',
    },
    startUrl: {
      type: 'string',
      required: true,
      description: 'URL of the webpage to start the agent on',
    },
    outputSchema: {
      type: 'json',
      required: false,
      description: 'Optional JSON schema defining the structure of data the agent should return',
    },
    variables: {
      type: 'json',
      required: false,
      description:
        'Optional variables to substitute in the task (format: {key: value}). Reference in task using %key%',
    },
    apiKey: {
      type: 'string',
      required: true,
      description: 'OpenAI API key for agent execution (required by Stagehand)',
    },
  },

  // Use HTTP request for server-side execution
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

  // Transform the response
  transformResponse: async (response) => {
    try {
      const data = await response.json()

      if (!response.ok) {
        logger.error('Failed Stagehand agent response', {
          status: response.status,
          error: data.error,
        })

        return {
          success: false,
          output: {
            agentResult: {
              success: false,
              completed: false,
              message: data.error || 'Failed to execute agent task using Stagehand',
              actions: [],
            },
          },
          error: data.error || 'Failed to execute agent task using Stagehand',
        }
      }

      logger.info('Successful Stagehand agent response', {
        agentSuccess: data.agentResult?.success,
        hasStructuredOutput: !!data.structuredOutput,
      })

      return {
        success: true,
        output: {
          agentResult: data.agentResult,
          structuredOutput: data.structuredOutput || {},
        },
      }
    } catch (error) {
      logger.error('Error processing Stagehand agent response', { error })
      return {
        success: false,
        output: {
          agentResult: {
            success: false,
            completed: false,
            message: 'Failed to process agent response',
            actions: [],
          },
        },
        error: 'Failed to process agent response',
      }
    }
  },

  // Handle errors
  transformError: (error) => {
    logger.error('Stagehand agent error', { error })
    return error instanceof Error ? error.message : 'Unknown error during agent execution'
  },
}
