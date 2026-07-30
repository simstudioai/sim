import type { ExaAnswerParams, ExaAnswerResponse } from '@/tools/exa/types'
import { parseJsonSchema, requireCostTotal } from '@/tools/exa/utils'
import type { ToolConfig } from '@/tools/types'

export const answerTool: ToolConfig<ExaAnswerParams, ExaAnswerResponse> = {
  id: 'exa_answer',
  name: 'Exa Answer',
  description: 'Get an AI-generated answer to a question with citations from the web using Exa AI.',
  version: '2.0.0',

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
      description:
        'Include the full page text of each cited source (default: false). This does not affect the answer itself.',
    },
    outputSchema: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON Schema describing the answer shape. When supplied, the answer is returned as a structured object instead of a string.',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Exa AI API Key',
    },
  },
  hosting: {
    envKeyPrefix: 'EXA_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'exa',
    pricing: {
      type: 'custom',
      getCost: (_params, output) => {
        const cost = requireCostTotal(output, 'answer')
        return { cost, metadata: { costDollars: output.__costDollars } }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 5,
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

      if (params.text) body.text = params.text

      const outputSchema = parseJsonSchema(params.outputSchema, 'outputSchema')
      if (outputSchema) body.outputSchema = outputSchema

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        answer: data.answer ?? '',
        citations:
          data.citations?.map((citation: any) => ({
            id: citation.id,
            title: citation.title || '',
            url: citation.url,
            text: citation.text || '',
            author: citation.author,
            publishedDate: citation.publishedDate,
          })) || [],
        requestId: data.requestId,
        __costDollars: data.costDollars,
      },
    }
  },

  outputs: {
    answer: {
      type: 'json',
      description:
        'AI-generated answer to the question. A string, or an object matching outputSchema when one was supplied.',
    },
    citations: {
      type: 'array',
      description: 'Sources and citations for the answer',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Exa identifier for the cited source' },
          title: { type: 'string', description: 'The title of the cited source' },
          url: { type: 'string', description: 'The URL of the cited source' },
          text: {
            type: 'string',
            description: 'Full page text of the cited source, when text is enabled',
          },
          author: { type: 'string', description: 'The author of the cited source' },
          publishedDate: { type: 'string', description: 'Publication date of the cited source' },
        },
      },
    },
    requestId: { type: 'string', description: 'Exa request identifier, useful for support' },
  },
}
