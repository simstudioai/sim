import type { JamaListItemTypesParams, JamaListItemTypesResponse } from '@/tools/jama/types'
import {
  JAMA_ITEM_TYPE_PROPERTIES,
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
  mapJamaItemType,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaListItemTypesTool: ToolConfig<JamaListItemTypesParams, JamaListItemTypesResponse> =
  {
    id: 'jama_list_item_types',
    name: 'Jama List Item Types',
    description: "List Item Types in Jama Connect using the connected user's access permissions.",
    version: '1.0.0',
    oauth: jamaOAuth,
    params: {
      ...jamaAuthParams,
      ...jamaPaginationParams,
      projectId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Only item types enabled in this project',
      },
    },
    request: {
      url: (params) =>
        jamaUrl(
          params.instanceUrl,
          params.projectId
            ? `/projects/${jamaId(params.projectId, 'projectId')}/itemtypes`
            : '/itemtypes',
          { ...jamaPagination(params) }
        ),
      method: 'GET',
      headers: jamaHeaders,
      retry: JAMA_RETRY,
      redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
    },
    transformResponse: async (response) => {
      const body = await readJamaEnvelope(response)
      return {
        success: true,
        output: { itemTypes: jamaList(body).map(mapJamaItemType), pageInfo: jamaPageInfo(body) },
      }
    },
    outputs: {
      itemTypes: {
        type: 'array',
        description: 'List Item Types result',
        items: { type: 'object', properties: JAMA_ITEM_TYPE_PROPERTIES },
      },
      pageInfo: JAMA_PAGE_INFO_OUTPUT,
    },
  }
