import {
  type CheckrGetNodeParams,
  type CheckrNodeResponse,
  NODE_PROPERTIES,
} from '@/tools/checkr/types'
import {
  CHECKR_API_KEY_PARAM,
  CHECKR_ERROR_EXTRACTOR,
  checkrHeaders,
  checkrId,
  checkrUrl,
  mapNode,
} from '@/tools/checkr/utils'
import type { ToolConfig } from '@/tools/types'

export const checkrGetNodeTool: ToolConfig<CheckrGetNodeParams, CheckrNodeResponse> = {
  id: 'checkr_get_node',
  name: 'Checkr Get Node',
  description: 'Retrieve an account hierarchy node by its custom ID.',
  version: '1.0.0',
  errorExtractor: CHECKR_ERROR_EXTRACTOR,

  params: {
    ...CHECKR_API_KEY_PARAM,
    nodeCustomId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Custom ID of the node',
    },
    includePackages: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include the package slugs available to the node',
    },
  },

  request: {
    url: (params) =>
      checkrUrl(`/nodes/${checkrId(params.nodeCustomId, 'nodeCustomId')}`, {
        include: params.includePackages === true ? 'packages' : undefined,
      }),
    method: 'GET',
    headers: (params) => checkrHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: { node: mapNode(data) } }
  },

  outputs: {
    node: { type: 'object', description: 'The node', properties: NODE_PROPERTIES },
  },
}
