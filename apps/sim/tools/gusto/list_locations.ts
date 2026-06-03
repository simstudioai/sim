import type { GustoListLocationsParams, GustoListLocationsResponse } from '@/tools/gusto/types'
import { LOCATION_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoListLocationsTool: ToolConfig<
  GustoListLocationsParams,
  GustoListLocationsResponse
> = {
  id: 'gusto_list_locations',
  name: 'Gusto List Locations',
  description: 'List locations for a Gusto company',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'gusto',
  },

  params: {
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto company UUID',
    },
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
  },

  request: {
    url: (params) =>
      `${GUSTO_API_BASE}/companies/${encodeURIComponent(params.companyId.trim())}/locations`,
    method: 'GET',
    headers: (params) => gustoHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to list locations'),
        output: {},
      }
    }
    return {
      success: true,
      output: { locations: Array.isArray(data) ? data : (data.locations ?? []) },
    }
  },

  outputs: {
    locations: {
      type: 'array',
      description: 'List of locations',
      items: {
        type: 'object',
        properties: LOCATION_OUTPUT_PROPERTIES,
      },
    },
  },
}
