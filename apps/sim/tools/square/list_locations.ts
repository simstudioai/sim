import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ListLocationsParams, LocationListResponse } from '@/tools/square/types'
import { LOCATION_OUTPUT, SQUARE_BASE_URL, squareHeaders } from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareListLocationsTool: ToolConfig<ListLocationsParams, LocationListResponse> = {
  id: 'square_list_locations',
  name: 'Square List Locations',
  description: 'List all locations associated with the Square account',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
  },

  request: {
    url: () => `${SQUARE_BASE_URL}/v2/locations`,
    method: 'GET',
    headers: (params) => squareHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const locations = data.locations ?? []
    return {
      success: true,
      output: {
        locations,
        metadata: {
          count: locations.length,
        },
      },
    }
  },

  outputs: {
    locations: {
      type: 'array',
      description: 'Array of location objects',
      items: LOCATION_OUTPUT,
    },
    metadata: {
      type: 'json',
      description: 'List metadata',
      properties: {
        count: { type: 'number', description: 'Number of locations returned' },
      },
    },
  },
}
