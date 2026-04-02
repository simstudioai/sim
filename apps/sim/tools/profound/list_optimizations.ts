import type { ToolConfig } from '@/tools/types'
import type { ProfoundListOptimizationsParams, ProfoundListOptimizationsResponse } from './types'

export const profoundListOptimizationsTool: ToolConfig<
  ProfoundListOptimizationsParams,
  ProfoundListOptimizationsResponse
> = {
  id: 'profound_list_optimizations',
  name: 'Profound List Optimizations',
  description: 'List content optimization entries for an asset in Profound',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Profound API Key',
    },
    assetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Asset ID (UUID)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (default 10000, max 50000)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset for pagination (default 0)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `https://api.tryprofound.com/v1/content/${encodeURIComponent(params.assetId)}/optimization`
      )
      if (params.limit != null) url.searchParams.set('limit', String(params.limit))
      if (params.offset != null) url.searchParams.set('offset', String(params.offset))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.detail?.[0]?.msg || 'Failed to list optimizations')
    }
    return {
      success: true,
      output: {
        totalRows: data.info?.total_rows ?? 0,
        optimizations: (data.data ?? []).map(
          (item: {
            id: string
            title: string
            created_at: string
            extracted_input: string | null
            type: string
            status: string
          }) => ({
            id: item.id ?? null,
            title: item.title ?? null,
            createdAt: item.created_at ?? null,
            extractedInput: item.extracted_input ?? null,
            type: item.type ?? null,
            status: item.status ?? null,
          })
        ),
      },
    }
  },

  outputs: {
    totalRows: {
      type: 'number',
      description: 'Total number of optimization entries',
    },
    optimizations: {
      type: 'json',
      description: 'List of content optimization entries',
      properties: {
        id: { type: 'string', description: 'Optimization ID (UUID)' },
        title: { type: 'string', description: 'Content title' },
        createdAt: { type: 'string', description: 'When the optimization was created' },
        extractedInput: { type: 'string', description: 'Extracted input text' },
        type: { type: 'string', description: 'Content type: file, text, or url' },
        status: { type: 'string', description: 'Optimization status' },
      },
    },
  },
}
