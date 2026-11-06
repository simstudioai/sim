import type { JamaGetItemParams, JamaGetItemResponse } from '@/tools/jama/types'
import {
  JAMA_ITEM_PROPERTIES,
  JAMA_RETRY,
  jamaAuthParams,
  jamaData,
  jamaHeaders,
  jamaId,
  jamaOAuth,
  jamaUrl,
  mapJamaItem,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaGetItemTool: ToolConfig<JamaGetItemParams, JamaGetItemResponse> = {
  id: 'jama_get_item',
  name: 'Jama Get Item',
  description: "Get Item in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    itemId: { type: 'string', required: true, visibility: 'user-or-llm', description: 'item ID' },
  },
  request: {
    url: (params) => jamaUrl(params.instanceUrl, `/items/${jamaId(params.itemId, 'itemId')}`, {}),
    method: 'GET',
    headers: jamaHeaders,
    retry: JAMA_RETRY,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response) => {
    const body = await readJamaEnvelope(response)
    return { success: true, output: { item: mapJamaItem(jamaData(body)) } }
  },
  outputs: {
    item: { type: 'object', description: 'Get Item result', properties: JAMA_ITEM_PROPERTIES },
  },
}
