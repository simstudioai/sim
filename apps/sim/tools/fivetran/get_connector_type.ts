import { toRecordOrNull } from '@sim/utils/object'
import {
  CONNECTOR_TYPE_PROPERTIES,
  type FivetranGetConnectorTypeParams,
  type FivetranGetConnectorTypeResponse,
} from '@/tools/fivetran/types'
import {
  envelopeData,
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  fivetranHeaders,
  fivetranId,
  fivetranUrl,
  mapConnectorType,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranGetConnectorTypeTool: ToolConfig<
  FivetranGetConnectorTypeParams,
  FivetranGetConnectorTypeResponse
> = {
  id: 'fivetran_get_connector_type',
  name: 'Fivetran Get Connector Type',
  description:
    'Get the configuration and authorization fields a Fivetran connector type takes, to build the config for Create Connection.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    service: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Connector type ID, e.g. okta (see List Connector Types)',
    },
  },

  request: {
    url: (params) =>
      fivetranUrl(`/metadata/connector-types/${fivetranId(params.service, 'service')}`),
    method: 'GET',
    headers: (params) => fivetranHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = envelopeData(await response.json())
    return {
      success: true,
      output: {
        connectorType: mapConnectorType(data),
        config: toRecordOrNull(data.config),
        auth: toRecordOrNull(data.auth),
      },
    }
  },

  outputs: {
    connectorType: {
      type: 'object',
      description: 'The connector type',
      properties: CONNECTOR_TYPE_PROPERTIES,
    },
    config: {
      type: 'json',
      description: 'JSON Schema of the configuration fields the connector takes in config',
      nullable: true,
    },
    auth: {
      type: 'json',
      description: 'JSON Schema of the authorization fields the connector takes in auth, if any',
      nullable: true,
    },
  },
}
