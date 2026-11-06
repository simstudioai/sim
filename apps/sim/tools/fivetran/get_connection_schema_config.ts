import {
  type FivetranConnectionParams,
  type FivetranSchemaConfigResponse,
  SCHEMA_CONFIG_OUTPUTS,
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
  mapSchemaConfig,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranGetConnectionSchemaConfigTool: ToolConfig<
  FivetranConnectionParams,
  FivetranSchemaConfigResponse
> = {
  id: 'fivetran_get_connection_schema_config',
  name: 'Fivetran Get Connection Schema Config',
  description:
    'Get the schemas, tables, and columns a Fivetran connection syncs, and whether each is enabled.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_CONNECTION_ID_PARAM,
  },

  request: {
    url: (params) =>
      fivetranUrl(`/connections/${fivetranId(params.connectionId, 'connectionId')}/schemas`),
    method: 'GET',
    headers: (params) => fivetranHeaders(params),
  },

  transformResponse: async (response: Response) => {
    return { success: true, output: mapSchemaConfig(envelopeData(await response.json())) }
  },

  outputs: { ...SCHEMA_CONFIG_OUTPUTS },
}
