import {
  DESTINATION_PROPERTIES,
  type FivetranListDestinationsParams,
  type FivetranListDestinationsResponse,
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
  mapDestination,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranListDestinationsTool: ToolConfig<
  FivetranListDestinationsParams,
  FivetranListDestinationsResponse
> = {
  id: 'fivetran_list_destinations',
  name: 'Fivetran List Destinations',
  description:
    'List the destinations in the Fivetran account, such as Databricks or Snowflake, with their region and setup status.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_PAGINATION_PARAMS,
  },

  request: {
    url: (params) => fivetranUrl('/destinations', fivetranPaginationQuery(params)),
    method: 'GET',
    headers: (params) => fivetranHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const { items, nextCursor } = envelopePage(await response.json())
    return { success: true, output: { destinations: items.map(mapDestination), nextCursor } }
  },

  outputs: {
    destinations: {
      type: 'array',
      description: 'Destinations',
      items: { type: 'object', properties: DESTINATION_PROPERTIES },
    },
    ...NEXT_CURSOR_OUTPUT,
  },
}
