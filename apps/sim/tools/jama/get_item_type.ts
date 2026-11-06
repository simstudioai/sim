import type { JamaGetItemTypeParams, JamaGetItemTypeResponse } from '@/tools/jama/types'
import {
  JAMA_ITEM_TYPE_PROPERTIES,
  JAMA_RETRY,
  jamaAuthParams,
  jamaData,
  jamaHeaders,
  jamaId,
  jamaOAuth,
  jamaUrl,
  mapJamaItemType,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaGetItemTypeTool: ToolConfig<JamaGetItemTypeParams, JamaGetItemTypeResponse> = {
  id: 'jama_get_item_type',
  name: 'Jama Get Item Type',
  description: "Get Item Type in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    itemTypeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'itemType ID',
    },
  },
  request: {
    url: (params) =>
      jamaUrl(params.instanceUrl, `/itemtypes/${jamaId(params.itemTypeId, 'itemTypeId')}`, {}),
    method: 'GET',
    headers: jamaHeaders,
    retry: JAMA_RETRY,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response) => {
    const body = await readJamaEnvelope(response)
    return { success: true, output: { itemType: mapJamaItemType(jamaData(body)) } }
  },
  outputs: {
    itemType: {
      type: 'object',
      description: 'Get Item Type result',
      properties: JAMA_ITEM_TYPE_PROPERTIES,
    },
  },
}
