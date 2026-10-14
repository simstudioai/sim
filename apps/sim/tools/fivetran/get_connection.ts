import {
  CONNECTION_PROPERTIES,
  type FivetranConnectionParams,
  type FivetranConnectionResponse,
} from '@/tools/fivetran/types'
import {
  envelopeData,
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_CONNECTION_ID_PARAM,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  fivetranHeaders,
  fivetranId,
  fivetranUrl,
  mapConnection,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranGetConnectionTool: ToolConfig<
  FivetranConnectionParams,
  FivetranConnectionResponse
> = {
  id: 'fivetran_get_connection',
  name: 'Fivetran Get Connection',
  description:
    'Get a Fivetran connection, including its setup, sync, and update state, open tasks and warnings, and schedule.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_CONNECTION_ID_PARAM,
  },

  request: {
    url: (params) => fivetranUrl(`/connections/${fivetranId(params.connectionId, 'connectionId')}`),
    method: 'GET',
    headers: (params) => fivetranHeaders(params),
  },

  transformResponse: async (response: Response) => {
    return {
      success: true,
      output: { connection: mapConnection(envelopeData(await response.json())) },
    }
  },

  outputs: {
    connection: {
      type: 'object',
      description: 'The connection',
      properties: CONNECTION_PROPERTIES,
    },
  },
}
