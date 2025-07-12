import type { ToolConfig } from '../types'
import type { LinkupSearchParams, LinkupSearchResponse, LinkupSearchToolResponse } from './types'

export const searchTool: ToolConfig<LinkupSearchParams, LinkupSearchToolResponse> = {
  id: 'linkup_search',
  name: 'Linkup Search',
  description: 'Search the web for information using Linkup',
  version: '1.0.0',

  params: {
    q: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query',
    },
    depth: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search depth (has to either be "standard" or "deep")',
    },
    outputType: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Type of output to return (has to either be "sourcedAnswer" or "searchResults")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enter your Linkup API key',
    },
  },

  request: {
    url: 'https://api.linkup.so/v1/search',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        q: params.q,
      }

      if (params.depth) body.depth = params.depth
      if (params.outputType) body.outputType = params.outputType
      body.includeImages = false

      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Linkup API error: ${response.status} ${errorText}`)
    }

    const data: LinkupSearchResponse = await response.json()

    return {
      success: true,
      output: {
        answer: data.answer,
        sources: data.sources,
      },
    }
  },

  transformError: (error) => {
    return `Error searching with Linkup: ${error.message}`
  },
}
