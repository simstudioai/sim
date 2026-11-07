import type { JamaDeleteItemParams, JamaDeleteItemResponse } from '@/tools/jama/types'
import {
  assertJamaResponse,
  jamaAuthParams,
  jamaHeaders,
  jamaId,
  jamaOAuth,
  jamaUrl,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaDeleteItemTool: ToolConfig<JamaDeleteItemParams, JamaDeleteItemResponse> = {
  id: 'jama_delete_item',
  name: 'Jama Delete Item',
  description: "Delete Item in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    itemId: { type: 'string', required: true, visibility: 'user-or-llm', description: 'item ID' },
  },
  request: {
    url: (params) => jamaUrl(params.instanceUrl, `/items/${jamaId(params.itemId, 'itemId')}`, {}),
    method: 'DELETE',
    headers: jamaHeaders,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response) => {
    assertJamaResponse(response)
    return { success: true, output: { status: response.status } }
  },
  outputs: {
    status: { type: 'number', description: 'Successful HTTP status code' },
  },
}
