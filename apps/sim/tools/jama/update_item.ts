import type { JamaUpdateItemParams, JamaUpdateItemResponse } from '@/tools/jama/types'
import {
  assertJamaResponse,
  JAMA_RETRY,
  jamaAuthParams,
  jamaHeaders,
  jamaId,
  jamaOAuth,
  jamaPatch,
  jamaUrl,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaUpdateItemTool: ToolConfig<JamaUpdateItemParams, JamaUpdateItemResponse> = {
  id: 'jama_update_item',
  name: 'Jama Update Item',
  description: "Update Item in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    itemId: { type: 'string', required: true, visibility: 'user-or-llm', description: 'item ID' },
    patch: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON Patch array using add, remove, or replace, for example [{"op":"replace","path":"/fields/name","value":"Updated name"}]',
    },
  },
  request: {
    url: (params) => jamaUrl(params.instanceUrl, `/items/${jamaId(params.itemId, 'itemId')}`, {}),
    method: 'PATCH',
    headers: jamaHeaders,
    retry: JAMA_RETRY,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
    body: (params) => jamaPatch(params.patch),
  },
  transformResponse: async (response) => {
    assertJamaResponse(response)
    return { success: true, output: { status: response.status } }
  },
  outputs: {
    status: { type: 'number', description: 'Successful HTTP status code' },
  },
}
