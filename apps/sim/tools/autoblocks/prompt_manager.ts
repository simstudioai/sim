import { createLogger } from '@/lib/logs/console-logger'
import { ToolConfig } from '../types'
import { PromptManagerParams, PromptManagerResponse } from './types'

const logger = createLogger('AutoblocksPromptManagerTool')

export const promptManagerTool: ToolConfig<PromptManagerParams, PromptManagerResponse> = {
  id: 'autoblocks_prompt_manager',
  name: 'Autoblocks Prompt Manager',
  description: 'Manage and render prompts using Autoblocks prompt management system',
  version: '1.0.0',

  params: {
    promptId: {
      type: 'string',
      required: true,
      description: 'The ID of the prompt to retrieve',
    },
    version: {
      type: 'string',
      required: true,
      description: 'Version strategy (latest or specific)',
    },
    specificVersion: {
      type: 'string',
      required: false,
      description: 'Specific version to use (e.g., "1.2" or "1.latest")',
    },
    templateParams: {
      type: 'object',
      required: false,
      description: 'Parameters to render the template with',
    },
    apiKey: {
      type: 'string',
      required: true,
      description: 'Autoblocks API key',
    },
    enableABTesting: {
      type: 'boolean',
      required: false,
      description: 'Whether to enable A/B testing between versions',
    },
    abTestConfig: {
      type: 'object',
      required: false,
      description: 'Configuration for A/B testing between versions',
    },
    environment: {
      type: 'string',
      required: true,
      description: 'Environment to use (production, staging, development)',
    },
  },

  request: {
    url: 'https://api.autoblocks.ai/v1/prompts',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
      'X-Environment': params.environment,
    }),
    body: (params) => {
      const requestBody: Record<string, any> = {
        promptId: params.promptId,
        templateParams: params.templateParams || {},
      }

      // Handle version selection
      if (params.version === 'specific' && params.specificVersion) {
        requestBody.version = params.specificVersion
      } else {
        requestBody.version = 'latest'
      }

      // Handle A/B testing
      if (params.enableABTesting && params.abTestConfig) {
        requestBody.versions = params.abTestConfig.versions
      }

      return requestBody
    },
  },

  transformResponse: async (response) => {
    try {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || `Error: ${response.status} ${response.statusText}`)
      }

      return {
        success: true,
        output: {
          promptId: data.promptId,
          version: data.version,
          renderedPrompt: data.renderedPrompt,
          templates: data.templates || {},
        },
      }
    } catch (error) {
      logger.error('Error transforming Autoblocks response', error)
      throw error
    }
  },

  transformError: (error) => {
    logger.error('Autoblocks prompt manager error', error)
    return `Error processing Autoblocks prompt: ${error.message || String(error)}`
  },
}
