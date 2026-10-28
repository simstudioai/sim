import {
  CONNECTOR_TYPE_PROPERTIES,
  type FivetranListConnectorTypesParams,
  type FivetranListConnectorTypesResponse,
  NEXT_CURSOR_OUTPUT,
} from '@/tools/fivetran/types'
import {
  envelopePage,
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  FIVETRAN_PAGINATION_PARAMS,
  fivetranHeaders,
  fivetranPaginationQuery,
  fivetranUrl,
  mapConnectorType,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranListConnectorTypesTool: ToolConfig<
  FivetranListConnectorTypesParams,
  FivetranListConnectorTypesResponse
> = {
  id: 'fivetran_list_connector_types',
  name: 'Fivetran List Connector Types',
  description:
    'List the source connector types available in Fivetran, with the service ID to use when creating a connection.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_PAGINATION_PARAMS,
  },

  request: {
    url: (params) => fivetranUrl('/metadata/connector-types', fivetranPaginationQuery(params)),
    method: 'GET',
    headers: (params) => fivetranHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const { items, nextCursor } = envelopePage(await response.json())
    return {
      success: true,
      output: { connectorTypes: items.map(mapConnectorType), nextCursor },
    }
  },

  outputs: {
    connectorTypes: {
      type: 'array',
      description: 'Connector types',
      items: {
        type: 'object',
        properties: CONNECTOR_TYPE_PROPERTIES,
      },
    },
    ...NEXT_CURSOR_OUTPUT,
  },
}
