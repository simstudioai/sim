import {
  type FivetranGetGroupResponse,
  type FivetranGroupParams,
  GROUP_PROPERTIES,
} from '@/tools/fivetran/types'
import {
  envelopeData,
  FIVETRAN_AUTH_PARAMS,
  FIVETRAN_ERROR_EXTRACTOR,
  FIVETRAN_OAUTH,
  fivetranHeaders,
  fivetranId,
  fivetranUrl,
  mapGroup,
} from '@/tools/fivetran/utils'
import type { ToolConfig } from '@/tools/types'

export const fivetranGetGroupTool: ToolConfig<FivetranGroupParams, FivetranGetGroupResponse> = {
  id: 'fivetran_get_group',
  name: 'Fivetran Get Group',
  description: 'Get a Fivetran group by ID.',
  version: '1.0.0',
  errorExtractor: FIVETRAN_ERROR_EXTRACTOR,
  oauth: FIVETRAN_OAUTH,

  params: {
    ...FIVETRAN_AUTH_PARAMS,
    groupId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the group',
    },
  },

  request: {
    url: (params) => fivetranUrl(`/groups/${fivetranId(params.groupId, 'groupId')}`),
    method: 'GET',
    headers: (params) => fivetranHeaders(params),
  },

  transformResponse: async (response: Response) => {
    return { success: true, output: { group: mapGroup(envelopeData(await response.json())) } }
  },

  outputs: {
    group: { type: 'object', description: 'The group', properties: GROUP_PROPERTIES },
  },
}
