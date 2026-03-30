import type { ToolConfig } from '@/tools/types'
import type { ProfoundCitationsReportParams, ProfoundCitationsReportResponse } from './types'

export const profoundCitationsReportTool: ToolConfig<
  ProfoundCitationsReportParams,
  ProfoundCitationsReportResponse
> = {
  id: 'profound_citations_report',
  name: 'Profound Citations Report',
  description: 'Query citations report for a category in Profound',
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
    metrics: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated metrics: count, citation_share',
    },
    dimensions: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated dimensions: hostname, path, date, region, topic, model, tag, prompt, url, root_domain, persona, citation_category',
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
        'JSON array of filter objects, e.g. [{"field":"hostname","operator":"is","value":"example.com"}]',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (default 10000, max 50000)',
    },
  },

  request: {
    url: 'https://api.tryprofound.com/v1/reports/citations',
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
      throw new Error(data.detail?.[0]?.msg || 'Failed to query citations report')
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
      description: 'Report data rows with metrics and dimension values',
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
