import type {
  FivetranListConnectorTypesParams,
  FivetranListConnectorTypesResponse,
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
  NEXT_CURSOR_OUTPUT,
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
        properties: {
          id: { type: 'string', description: 'Service ID used when creating a connection' },
          name: { type: 'string', description: 'Display name', nullable: true },
          type: {
            type: 'string',
            description: 'Category, e.g. Security or Database',
            nullable: true,
          },
          description: { type: 'string', description: 'What the connector does', nullable: true },
          connectorClass: {
            type: 'string',
            description: 'Connector class (standard or lite)',
            nullable: true,
          },
          serviceStatus: {
            type: 'string',
            description:
              'Availability (general_availability, beta, private_preview, sunset, development)',
            nullable: true,
          },
          iconUrl: { type: 'string', description: 'Icon URL', nullable: true },
          linkToDocs: { type: 'string', description: 'Documentation URL', nullable: true },
          linkToErd: { type: 'string', description: 'ERD URL', nullable: true },
          supportsSchemaReload: {
            type: 'boolean',
            description: 'Whether schema reload is supported',
            nullable: true,
          },
          supportedFeatures: {
            type: 'array',
            description: 'Supported feature IDs, e.g. RE_SYNC or HISTORY',
            items: { type: 'string' },
          },
        },
      },
    },
    ...NEXT_CURSOR_OUTPUT,
  },
}
