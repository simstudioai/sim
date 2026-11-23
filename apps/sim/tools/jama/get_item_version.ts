import type { JamaGetItemVersionParams, JamaGetItemVersionResponse } from '@/tools/jama/types'
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

export const jamaGetItemVersionTool: ToolConfig<
  JamaGetItemVersionParams,
  JamaGetItemVersionResponse
> = {
  id: 'jama_get_item_version',
  name: 'Jama Get Item Version',
  description: "Get Item Version in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    itemId: { type: 'string', required: true, visibility: 'user-or-llm', description: 'item ID' },
    versionNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Version number returned by List Item Versions',
    },
  },
  request: {
    url: (params) =>
      jamaUrl(
        params.instanceUrl,
        `/items/${jamaId(params.itemId, 'itemId')}/versions/${jamaId(params.versionNumber, 'versionNumber')}/versioneditem`,
        {}
      ),
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
    item: {
      type: 'object',
      description: 'Get Item Version result',
      properties: JAMA_ITEM_PROPERTIES,
    },
  },
}
