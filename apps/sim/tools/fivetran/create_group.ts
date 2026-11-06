import {
  type FivetranCreateGroupParams,
  type FivetranGetGroupResponse,
  GROUP_PROPERTIES,
} from '@/tools/fivetran/types'
import {
  envelopeData,
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  fivetranHeaders,
  fivetranUrl,
  mapGroup,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranCreateGroupTool: ToolConfig<
  FivetranCreateGroupParams,
  FivetranGetGroupResponse
> = {
  id: 'fivetran_create_group',
  name: 'Fivetran Create Group',
  description:
    'Create a Fivetran group. Each group holds one destination, so create the group first, then its destination.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the group',
    },
  },

  request: {
    url: () => fivetranUrl('/groups'),
    method: 'POST',
    headers: (params) => fivetranHeaders(params),
    body: (params) => ({ name: params.name?.trim() }),
  },

  transformResponse: async (response: Response) => {
    return { success: true, output: { group: mapGroup(envelopeData(await response.json())) } }
  },

  outputs: {
    group: { type: 'object', description: 'The created group', properties: GROUP_PROPERTIES },
  },
}
