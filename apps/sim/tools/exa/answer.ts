import type { ExaAnswerParams, ExaAnswerResponse } from '@/tools/exa/types'
import type { ToolConfig } from '@/tools/types'

export const answerTool: ToolConfig<ExaAnswerParams, ExaAnswerResponse> = {
  id: 'exa_answer',
  name: 'Exa Answer',
  description: 'Get an AI-generated answer to a question with citations from the web using Exa AI.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The question to answer',
    },
    text: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Whether to include the full text of the answer',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Exa AI API Key',
    },
  },

  request: {
    url: 'https://api.exa.ai/answer',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        query: params.query,
      }

      // Add optional parameters if provided
      if (params.text) body.text = params.text

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        query: data.query || '',
        answer: data.answer || '',
        citations:
          data.citations?.map((citation: any) => ({
            title: citation.title || '',
            url: citation.url,
            text: citation.text || '',
          })) || [],
      },
    }
  },

  outputs: {
    answer: {
      type: 'string',
      description: 'AI-generated answer to the question',
    },
    citations: {
      type: 'array',
      description: 'Sources and citations for the answer',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'The title of the cited source' },
          url: { type: 'string', description: 'The URL of the cited source' },
          text: { type: 'string', description: 'Relevant text from the cited source' },
        },
      },
    },
  },
}
