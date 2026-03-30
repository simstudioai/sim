import type { ToolConfig } from '@/tools/types'
import type { ProfoundListRegionsParams, ProfoundListRegionsResponse } from './types'

export const profoundListRegionsTool: ToolConfig<
  ProfoundListRegionsParams,
  ProfoundListRegionsResponse
> = {
  id: 'profound_list_regions',
  name: 'Profound List Regions',
  description: 'List all organization regions in Profound',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Profound API Key',
    },
  },

  request: {
    url: 'https://api.tryprofound.com/v1/org/regions',
    method: 'GET',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.detail?.[0]?.msg || 'Failed to list regions')
    }
    return {
      success: true,
      output: {
        regions: (data ?? []).map((item: { id: string; name: string }) => ({
          id: item.id ?? null,
          name: item.name ?? null,
        })),
      },
    }
  },

  outputs: {
    regions: {
      type: 'json',
      description: 'List of organization regions',
      properties: {
        id: { type: 'string', description: 'Region ID (UUID)' },
        name: { type: 'string', description: 'Region name' },
      },
    },
  },
}
