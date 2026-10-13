import {
  type FivetranListGroupsParams,
  type FivetranListGroupsResponse,
  GROUP_PROPERTIES,
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
  mapGroup,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranListGroupsTool: ToolConfig<
  FivetranListGroupsParams,
  FivetranListGroupsResponse
> = {
  id: 'fivetran_list_groups',
  name: 'Fivetran List Groups',
  description:
    'List the groups in the Fivetran account. Each group pairs with one destination, so the group ID is also the destination ID.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    ...FIVETRAN_PAGINATION_PARAMS,
  },

  request: {
    url: (params) => fivetranUrl('/groups', fivetranPaginationQuery(params)),
    method: 'GET',
    headers: (params) => fivetranHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const { items, nextCursor } = envelopePage(await response.json())
    return { success: true, output: { groups: items.map(mapGroup), nextCursor } }
  },

  outputs: {
    groups: {
      type: 'array',
      description: 'Groups in the account',
      items: { type: 'object', properties: GROUP_PROPERTIES },
    },
    ...NEXT_CURSOR_OUTPUT,
  },
}
