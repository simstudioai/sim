import { ErrorExtractorId } from '@/tools/error-extractors'
import { SQUARE_CREDENTIAL_OAUTH } from '@/tools/shared/saved-credentials'
import type { GetLocationParams, LocationResponse } from '@/tools/square/types'
import { LOCATION_OUTPUT, SQUARE_ENVIRONMENTS, squareHeaders } from '@/tools/square/types'
import type { ToolConfig } from '@/tools/types'

export const squareGetLocationTool: ToolConfig<GetLocationParams, LocationResponse> = {
  id: 'square_get_location',
  name: 'Square Get Location',
  description: 'Retrieve a single location by its ID',
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
    locationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the location to retrieve (use "main" for the main location)',
    },
  },

  request: {
    url: (params) =>
      `${SQUARE_ENVIRONMENTS.apiBase(params.environment)}/v2/locations/${encodeURIComponent(params.locationId)}`,
    method: 'GET',
    headers: (params) => squareHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    const location = data.location ?? {}
    return {
      success: true,
      output: {
        location,
        metadata: {
          id: location.id,
          name: location.name ?? null,
        },
      },
    }
  },

  outputs: {
    location: { ...LOCATION_OUTPUT, description: 'The retrieved location object' },
    metadata: {
      type: 'json',
      description: 'Location summary metadata',
      properties: {
        id: { type: 'string', description: 'Square location ID' },
        name: { type: 'string', description: 'Location name', optional: true },
      },
    },
  },
}
