import { createLogger } from '@/lib/logs/console-logger'
import type { ToolConfig } from '../types'
import type { StagehandExtractParams, StagehandExtractResponse } from './types'

const logger = createLogger('StagehandExtractTool')

export const extractTool: ToolConfig<StagehandExtractParams, StagehandExtractResponse> = {
  id: 'stagehand_extract',
  name: 'Stagehand Extract',
  description: 'Extract structured data from a webpage using Stagehand',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL of the webpage to extract data from',
    },
    instruction: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Instructions for extraction',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'OpenAI API key for extraction (required by Stagehand)',
    },
    schema: {
      type: 'json',
      required: true,
      visibility: 'user-only',
      description: 'JSON schema defining the structure of the data to extract',
    },
  },

  request: {
    url: '/api/tools/stagehand/extract',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      instruction: params.instruction,
      schema: params.schema,
      apiKey: params.apiKey,
      url: params.url,
    }),
  },

  transformResponse: async (response) => {
    try {
      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          output: {},
          error: data.error || 'Failed to extract data using Stagehand',
        }
      }

      return {
        success: true,
        output: data.data || {},
      }
    } catch (error) {
      logger.error('Error processing Stagehand extraction response', { error })
      return {
        success: false,
        output: {},
        error: 'Failed to process extraction response',
      }
    }
  },

  // Handle errors
  transformError: (error) => {
    logger.error('Stagehand extraction error', { error })
    return error instanceof Error ? error.message : 'Unknown error during extraction'
  },
}
