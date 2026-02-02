import { createLogger } from '@sim/logger'
import type { StagehandAgentParams, StagehandAgentResponse } from '@/tools/stagehand/types'
import { STAGEHAND_AGENT_RESULT_OUTPUT_PROPERTIES } from '@/tools/stagehand/types'
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
    provider: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'AI provider to use: openai or anthropic',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'API key for the selected provider',
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
        provider: params.provider || 'openai',
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
      properties: STAGEHAND_AGENT_RESULT_OUTPUT_PROPERTIES,
    },
    structuredOutput: {
      type: 'object',
      description: 'Extracted data matching the provided output schema',
    },
  },
}
