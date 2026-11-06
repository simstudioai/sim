import {
  DESTINATION_PROPERTIES,
  type FivetranDestinationParams,
  type FivetranDestinationResponse,
} from '@/tools/fivetran/types'
import {
  envelopeData,
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_DESTINATION_ID_PARAM,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  fivetranHeaders,
  fivetranId,
  fivetranUrl,
  mapDestination,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranGetDestinationTool: ToolConfig<
  FivetranDestinationParams,
  FivetranDestinationResponse
> = {
  id: 'fivetran_get_destination',
  name: 'Fivetran Get Destination',
  description: 'Get a Fivetran destination with its region, time zone, and setup status.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_DESTINATION_ID_PARAM,
  },

  request: {
    url: (params) =>
      fivetranUrl(`/destinations/${fivetranId(params.destinationId, 'destinationId')}`),
    method: 'GET',
    headers: (params) => fivetranHeaders(params),
  },

  transformResponse: async (response: Response) => {
    return {
      success: true,
      output: { destination: mapDestination(envelopeData(await response.json())) },
    }
  },

  outputs: {
    destination: {
      type: 'object',
      description: 'The destination',
      properties: DESTINATION_PROPERTIES,
    },
  },
}
