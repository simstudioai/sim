import {
  type CheckrListNodesParams,
  type CheckrListNodesResponse,
  LIST_META_OUTPUTS,
  NODE_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  CHECKR_PAGINATION_PARAMS,
  checkrHeaders,
  checkrPaginationQuery,
  checkrUrl,
  mapListMeta,
  mapNode,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrListNodesTool: ToolConfig<CheckrListNodesParams, CheckrListNodesResponse> = {
  id: 'checkr_list_nodes',
  name: 'Checkr List Nodes',
  description:
    'List the nodes in the account hierarchy. Hierarchy-enabled accounts need a node custom ID to order reports and invitations.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    includePackages: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include the package slugs available to each node',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field: custom_id or created_at (default created_at)',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: asc or desc (default asc)',
    },
    ...CHECKR_PAGINATION_PARAMS,
  },

  request: {
    url: (params) =>
      checkrUrl('/nodes', {
        include: params.includePackages === true ? 'packages' : undefined,
        order_by: params.orderBy,
        order: params.order,
        ...checkrPaginationQuery(params),
      }),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        nodes: (Array.isArray(data.data) ? data.data : []).map(mapNode),
        ...mapListMeta(data),
      },
    }
  },

  outputs: {
    nodes: {
      type: 'array',
      description: 'Hierarchy nodes',
      items: { type: 'object', properties: NODE_PROPERTIES },
    },
    ...LIST_META_OUTPUTS,
  },
}
