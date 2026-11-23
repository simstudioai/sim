import type { JamaListPickListsParams, JamaListPickListsResponse } from '@/tools/jama/types'
import {
  JAMA_PAGE_INFO_OUTPUT,
  JAMA_PICK_LIST_PROPERTIES,
  JAMA_RETRY,
  jamaAuthParams,
  jamaHeaders,
  jamaList,
  jamaOAuth,
  jamaPageInfo,
  jamaPagination,
  jamaPaginationParams,
  jamaUrl,
  mapJamaPickList,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaListPickListsTool: ToolConfig<JamaListPickListsParams, JamaListPickListsResponse> =
  {
    id: 'jama_list_pick_lists',
    name: 'Jama List Pick Lists',
    description: "List Pick Lists in Jama Connect using the connected user's access permissions.",
    version: '1.0.0',
    oauth: jamaOAuth,
    params: {
      ...jamaAuthParams,
      ...jamaPaginationParams,
    },
    request: {
      url: (params) => jamaUrl(params.instanceUrl, '/picklists', { ...jamaPagination(params) }),
      method: 'GET',
      headers: jamaHeaders,
      retry: JAMA_RETRY,
      redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
    },
    transformResponse: async (response) => {
      const body = await readJamaEnvelope(response)
      return {
        success: true,
        output: { pickLists: jamaList(body).map(mapJamaPickList), pageInfo: jamaPageInfo(body) },
      }
    },
    outputs: {
      pickLists: {
        type: 'array',
        description: 'List Pick Lists result',
        items: { type: 'object', properties: JAMA_PICK_LIST_PROPERTIES },
      },
      pageInfo: JAMA_PAGE_INFO_OUTPUT,
    },
  }
