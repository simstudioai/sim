import { ErrorExtractorId } from '@/tools/error-extractors'
import { SQUARE_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { ListLocationsParams, LocationListResponse } from '@/tools/square/types'
import { LOCATION_OUTPUT, SQUARE_ENVIRONMENTS, squareHeaders } from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareListLocationsTool: ToolConfig<ListLocationsParams, LocationListResponse> = {
  id: 'square_list_locations',
  name: 'Square List Locations',
  description: 'List all locations associated with the Square account',
  version: '1.0.0',
  oauth: SQUARE_CREDENTIAL_OAUTH,
  errorExtractor: ErrorExtractorId.SQUARE_ERRORS,

  params: {
    environment: SQUARE_ENVIRONMENTS.param,
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Square access token (personal access token)',
    },
  },

  request: {
    url: (params) => `${SQUARE_ENVIRONMENTS.apiBase(params.environment)}/v2/locations`,
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
