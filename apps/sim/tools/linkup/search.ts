import type {
  LinkupSearchParams,
  LinkupSearchResponse,
  LinkupSearchToolResponse,
} from '@/tools/linkup/types'
import type { ToolConfig } from '@/tools/types'

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
    const data: LinkupSearchResponse = await response.json()

    return {
      success: true,
      output: {
        answer: data.answer,
        sources: data.sources,
      },
    }
  },

  outputs: {
    answer: {
      type: 'string',
      description: 'The sourced answer to the search query',
    },
    sources: {
      type: 'array',
      description:
        'Array of sources used to compile the answer, each containing name, url, and snippet',
    },
  },
}
