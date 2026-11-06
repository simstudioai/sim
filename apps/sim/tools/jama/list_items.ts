import type { JamaListItemsParams, JamaListItemsResponse } from '@/tools/jama/types'
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

export const jamaListItemsTool: ToolConfig<JamaListItemsParams, JamaListItemsResponse> = {
  id: 'jama_list_items',
  name: 'Jama List Items',
  description: "List Items in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    ...jamaPaginationParams,
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'project ID',
    },
    rootOnly: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only root-level items in the project',
    },
  },
  request: {
    url: (params) =>
      jamaUrl(params.instanceUrl, '/items', {
        ...jamaPagination(params),
        project: jamaId(params.projectId, 'projectId'),
        rootOnly: params.rootOnly,
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
      description: 'List Items result',
      items: { type: 'object', properties: JAMA_ITEM_PROPERTIES },
    },
    pageInfo: JAMA_PAGE_INFO_OUTPUT,
  },
}
