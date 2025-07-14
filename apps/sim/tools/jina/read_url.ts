import type { ToolConfig } from '../types'
import type { ReadUrlParams, ReadUrlResponse } from './types'

export const readUrlTool: ToolConfig<ReadUrlParams, ReadUrlResponse> = {
  id: 'jina_read_url',
  name: 'Jina Reader',
  description:
    'Extract and process web content into clean, LLM-friendly text using Jina AI Reader. Supports advanced content parsing, link gathering, and multiple output formats with configurable processing options.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The URL to read and convert to markdown',
    },
    useReaderLMv2: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to use ReaderLM-v2 for better quality',
    },
    gatherLinks: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to gather all links at the end',
    },
    jsonResponse: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to return response in JSON format',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Jina AI API key',
    },
  },

  request: {
    url: (params: ReadUrlParams) => {
      return `https://r.jina.ai/https://${params.url.replace(/^https?:\/\//, '')}`
    },
    method: 'GET',
    headers: (params: ReadUrlParams) => {
      // Start with base headers
      const headers: Record<string, string> = {
        Accept: params.jsonResponse ? 'application/json' : 'text/plain',
        Authorization: `Bearer ${params.apiKey}`,
      }

      // Add conditional headers based on boolean values
      if (params.useReaderLMv2 === true) {
        headers['X-Respond-With'] = 'readerlm-v2'
      }
      if (params.gatherLinks === true) {
        headers['X-With-Links-Summary'] = 'true'
      }

      return headers
    },
  },

  transformResponse: async (response: Response) => {
    const content = await response.text()
    return {
      success: response.ok,
      output: {
        content,
      },
    }
  },

  transformError: (error) => {
    return error instanceof Error ? error.message : 'Failed to read URL'
  },
}
