import type { StagehandExtractParams, StagehandExtractResponse } from '@/tools/stagehand/types'
import type { ToolConfig } from '@/tools/types'

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
      provider: params.provider || 'openai',
      apiKey: params.apiKey,
      url: params.url,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: data.data || {},
    }
  },

  outputs: {
    data: {
      type: 'object',
      description: 'Extracted structured data matching the provided schema',
    },
  },
}
