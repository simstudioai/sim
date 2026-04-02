import type { ToolConfig } from '@/tools/types'
import type { ProfoundPromptVolumeParams, ProfoundPromptVolumeResponse } from './types'

export const profoundPromptVolumeTool: ToolConfig<
  ProfoundPromptVolumeParams,
  ProfoundPromptVolumeResponse
> = {
  id: 'profound_prompt_volume',
  name: 'Profound Prompt Volume',
  description:
    'Query prompt volume data to understand search demand across AI platforms in Profound',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Profound API Key',
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
    metrics: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated metrics: volume, change',
    },
    dimensions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated dimensions: keyword, date, platform, country_code, matching_type, frequency',
    },
    dateInterval: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Date interval: hour, day, week, month, year',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array of filter objects, e.g. [{"field":"keyword","operator":"contains","value":"best"}]',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (default 10000, max 50000)',
    },
  },

  request: {
    url: 'https://api.tryprofound.com/v1/prompt-volumes/volume',
    method: 'POST',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        start_date: params.startDate,
        end_date: params.endDate,
        metrics: params.metrics.split(',').map((m) => m.trim()),
      }
      if (params.dimensions) {
        body.dimensions = params.dimensions.split(',').map((d) => d.trim())
      }
      if (params.dateInterval) {
        body.date_interval = params.dateInterval
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
      throw new Error(data.detail?.[0]?.msg || 'Failed to query prompt volume')
    }
    return {
      success: true,
      output: {
        totalRows: data.info?.total_rows ?? 0,
        data: (data.data ?? []).map((row: { metrics: number[]; dimensions: string[] }) => ({
          metrics: row.metrics ?? [],
          dimensions: row.dimensions ?? [],
        })),
      },
    }
  },

  outputs: {
    totalRows: {
      type: 'number',
      description: 'Total number of rows in the report',
    },
    data: {
      type: 'json',
      description: 'Volume data rows with metrics and dimension values',
      properties: {
        metrics: {
          type: 'json',
          description: 'Array of metric values matching requested metrics order',
        },
        dimensions: {
          type: 'json',
          description: 'Array of dimension values matching requested dimensions order',
        },
      },
    },
  },
}
