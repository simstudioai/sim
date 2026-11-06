import type { JamaListItemCommentsParams, JamaListItemCommentsResponse } from '@/tools/jama/types'
import {
  JAMA_COMMENT_PROPERTIES,
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
  mapJamaComment,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaListItemCommentsTool: ToolConfig<
  JamaListItemCommentsParams,
  JamaListItemCommentsResponse
> = {
  id: 'jama_list_item_comments',
  name: 'Jama List Item Comments',
  description: "List Item Comments in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    ...jamaPaginationParams,
    itemId: { type: 'string', required: true, visibility: 'user-or-llm', description: 'item ID' },
  },
  request: {
    url: (params) =>
      jamaUrl(params.instanceUrl, `/items/${jamaId(params.itemId, 'itemId')}/comments`, {
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
      output: { comments: jamaList(body).map(mapJamaComment), pageInfo: jamaPageInfo(body) },
    }
  },
  outputs: {
    comments: {
      type: 'array',
      description: 'List Item Comments result',
      items: { type: 'object', properties: JAMA_COMMENT_PROPERTIES },
    },
    pageInfo: JAMA_PAGE_INFO_OUTPUT,
  },
}
