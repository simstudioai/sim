import type { JamaListItemVersionsParams, JamaListItemVersionsResponse } from '@/tools/jama/types'
import {
  JAMA_PAGE_INFO_OUTPUT,
  JAMA_RETRY,
  JAMA_VERSION_PROPERTIES,
  jamaAuthParams,
  jamaHeaders,
  jamaId,
  jamaList,
  jamaOAuth,
  jamaPageInfo,
  jamaPagination,
  jamaPaginationParams,
  jamaUrl,
  mapJamaVersion,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaListItemVersionsTool: ToolConfig<
  JamaListItemVersionsParams,
  JamaListItemVersionsResponse
> = {
  id: 'jama_list_item_versions',
  name: 'Jama List Item Versions',
  description: "List Item Versions in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    ...jamaPaginationParams,
    itemId: { type: 'string', required: true, visibility: 'user-or-llm', description: 'item ID' },
  },
  request: {
    url: (params) =>
      jamaUrl(params.instanceUrl, `/items/${jamaId(params.itemId, 'itemId')}/versions`, {
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
      output: { versions: jamaList(body).map(mapJamaVersion), pageInfo: jamaPageInfo(body) },
    }
  },
  outputs: {
    versions: {
      type: 'array',
      description: 'List Item Versions result',
      items: { type: 'object', properties: JAMA_VERSION_PROPERTIES },
    },
    pageInfo: JAMA_PAGE_INFO_OUTPUT,
  },
}
