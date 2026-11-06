import type { JamaGetFilterParams, JamaGetFilterResponse } from '@/tools/jama/types'
import {
  JAMA_FILTER_PROPERTIES,
  JAMA_RETRY,
  jamaAuthParams,
  jamaData,
  jamaHeaders,
  jamaId,
  jamaOAuth,
  jamaUrl,
  mapJamaFilter,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaGetFilterTool: ToolConfig<JamaGetFilterParams, JamaGetFilterResponse> = {
  id: 'jama_get_filter',
  name: 'Jama Get Filter',
  description: "Get Filter in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    filterId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'filter ID',
    },
  },
  request: {
    url: (params) =>
      jamaUrl(params.instanceUrl, `/filters/${jamaId(params.filterId, 'filterId')}`, {}),
    method: 'GET',
    headers: jamaHeaders,
    retry: JAMA_RETRY,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response) => {
    const body = await readJamaEnvelope(response)
    return { success: true, output: { filter: mapJamaFilter(jamaData(body)) } }
  },
  outputs: {
    filter: {
      type: 'object',
      description: 'Get Filter result',
      properties: JAMA_FILTER_PROPERTIES,
    },
  },
}
