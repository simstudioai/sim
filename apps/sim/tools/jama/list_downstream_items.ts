import type {
  JamaListDownstreamItemsParams,
  JamaListDownstreamItemsResponse,
} from '@/tools/jama/types'
import {
  JAMA_ITEM_PROPERTIES,
  JAMA_PAGE_INFO_OUTPUT,
  JAMA_RETRY,
  jamaAuthParams,
  jamaHeaders,
  jamaId,
  jamaList,
  jamaOAuth,
  jamaPageInfo,
  jamaPagination,
  jamaPaginationParams,
  jamaUrl,
  mapJamaItem,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaListDownstreamItemsTool: ToolConfig<
  JamaListDownstreamItemsParams,
  JamaListDownstreamItemsResponse
> = {
  id: 'jama_list_downstream_items',
  name: 'Jama List Downstream Items',
  description:
    "List Downstream Items in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    ...jamaPaginationParams,
    itemId: { type: 'string', required: true, visibility: 'user-or-llm', description: 'item ID' },
  },
  request: {
    url: (params) =>
      jamaUrl(params.instanceUrl, `/items/${jamaId(params.itemId, 'itemId')}/downstreamrelated`, {
        ...jamaPagination(params),
      }),
    method: 'GET',
    headers: jamaHeaders,
    retry: JAMA_RETRY,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response) => {
    const body = await readJamaEnvelope(response)
    return {
      success: true,
      output: { items: jamaList(body).map(mapJamaItem), pageInfo: jamaPageInfo(body) },
    }
  },
  outputs: {
    items: {
      type: 'array',
      description: 'List Downstream Items result',
      items: { type: 'object', properties: JAMA_ITEM_PROPERTIES },
    },
    pageInfo: JAMA_PAGE_INFO_OUTPUT,
  },
}
