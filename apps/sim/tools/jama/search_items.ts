import type { JamaSearchItemsParams, JamaSearchItemsResponse } from '@/tools/jama/types'
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

export const jamaSearchItemsTool: ToolConfig<JamaSearchItemsParams, JamaSearchItemsResponse> = {
  id: 'jama_search_items',
  name: 'Jama Search Items',
  description: "Search Items in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    ...jamaPaginationParams,
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Text to find in item names, descriptions, and fields',
    },
    projectId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict search to a project',
    },
    itemTypeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict search to an item type',
    },
    documentKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact document key',
    },
    modifiedSince: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only items modified since this ISO 8601 date',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field and direction, for example modifiedDate.desc',
    },
  },
  request: {
    url: (params) =>
      jamaUrl(params.instanceUrl, '/abstractitems', {
        ...jamaPagination(params),
        contains: params.query,
        project: params.projectId ? jamaId(params.projectId, 'projectId') : undefined,
        itemType: params.itemTypeId ? jamaId(params.itemTypeId, 'itemTypeId') : undefined,
        documentKey: params.documentKey,
        modifiedDate: params.modifiedSince,
        sortBy: params.sortBy,
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
      description: 'Search Items result',
      items: { type: 'object', properties: JAMA_ITEM_PROPERTIES },
    },
    pageInfo: JAMA_PAGE_INFO_OUTPUT,
  },
}
