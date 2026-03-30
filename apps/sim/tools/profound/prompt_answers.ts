import type { ToolConfig } from '@/tools/types'
import type { ProfoundPromptAnswersParams, ProfoundPromptAnswersResponse } from './types'

export const profoundPromptAnswersTool: ToolConfig<
  ProfoundPromptAnswersParams,
  ProfoundPromptAnswersResponse
> = {
  id: 'profound_prompt_answers',
  name: 'Profound Prompt Answers',
  description: 'Get raw prompt answers data for a category in Profound',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Profound API Key',
    },
    categoryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Category ID (UUID)',
    },
    startDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start date (YYYY-MM-DD or ISO 8601)',
    },
    endDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End date (YYYY-MM-DD or ISO 8601)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of filter objects, e.g. [{"field":"prompt_type","operator":"is","value":"visibility"}]',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (default 10000, max 50000)',
    },
  },

  request: {
    url: 'https://api.tryprofound.com/v1/prompts/answers',
    method: 'POST',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        category_id: params.categoryId,
        start_date: params.startDate,
        end_date: params.endDate,
      }
      if (params.filters) {
        try {
          body.filters = JSON.parse(params.filters)
        } catch {
          throw new Error('Invalid JSON in filters parameter')
        }
      }
      if (params.limit != null) {
        body.pagination = { limit: params.limit }
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.detail?.[0]?.msg || 'Failed to get prompt answers')
    }
    return {
      success: true,
      output: {
        totalRows: data.info?.total_rows ?? 0,
        data: (data.data ?? []).map(
          (row: {
            prompt: string | null
            prompt_type: string | null
            response: string | null
            mentions: string[] | null
            citations: string[] | null
            topic: string | null
            region: string | null
            model: string | null
            asset: string | null
            created_at: string | null
          }) => ({
            prompt: row.prompt ?? null,
            promptType: row.prompt_type ?? null,
            response: row.response ?? null,
            mentions: row.mentions ?? [],
            citations: row.citations ?? [],
            topic: row.topic ?? null,
            region: row.region ?? null,
            model: row.model ?? null,
            asset: row.asset ?? null,
            createdAt: row.created_at ?? null,
          })
        ),
      },
    }
  },

  outputs: {
    totalRows: {
      type: 'number',
      description: 'Total number of answer rows',
    },
    data: {
      type: 'json',
      description: 'Raw prompt answer data',
      properties: {
        prompt: { type: 'string', description: 'The prompt text' },
        promptType: { type: 'string', description: 'Prompt type (visibility or sentiment)' },
        response: { type: 'string', description: 'AI model response text' },
        mentions: { type: 'json', description: 'Companies/assets mentioned in the response' },
        citations: { type: 'json', description: 'URLs cited in the response' },
        topic: { type: 'string', description: 'Topic name' },
        region: { type: 'string', description: 'Region name' },
        model: { type: 'string', description: 'AI model/platform name' },
        asset: { type: 'string', description: 'Asset name' },
        createdAt: { type: 'string', description: 'Timestamp when the answer was collected' },
      },
    },
  },
}
