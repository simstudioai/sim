import type {
  JamaListPickListOptionsParams,
  JamaListPickListOptionsResponse,
} from '@/tools/jama/types'
import {
  JAMA_PAGE_INFO_OUTPUT,
  JAMA_PICK_LIST_OPTION_PROPERTIES,
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
  mapJamaPickListOption,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaListPickListOptionsTool: ToolConfig<
  JamaListPickListOptionsParams,
  JamaListPickListOptionsResponse
> = {
  id: 'jama_list_pick_list_options',
  name: 'Jama List Pick List Options',
  description:
    "List Pick List Options in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    ...jamaPaginationParams,
    pickListId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'pickList ID',
    },
  },
  request: {
    url: (params) =>
      jamaUrl(params.instanceUrl, `/picklists/${jamaId(params.pickListId, 'pickListId')}/options`, {
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
      output: { options: jamaList(body).map(mapJamaPickListOption), pageInfo: jamaPageInfo(body) },
    }
  },
  outputs: {
    options: {
      type: 'array',
      description: 'List Pick List Options result',
      items: { type: 'object', properties: JAMA_PICK_LIST_OPTION_PROPERTIES },
    },
    pageInfo: JAMA_PAGE_INFO_OUTPUT,
  },
}
