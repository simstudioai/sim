import type { JamaListFiltersParams, JamaListFiltersResponse } from '@/tools/jama/types'
import {
  JAMA_FILTER_PROPERTIES,
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
  mapJamaFilter,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaListFiltersTool: ToolConfig<JamaListFiltersParams, JamaListFiltersResponse> = {
  id: 'jama_list_filters',
  name: 'Jama List Filters',
  description: "List Filters in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    ...jamaPaginationParams,
    projectId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only filters for this project',
    },
  },
  request: {
    url: (params) =>
      jamaUrl(params.instanceUrl, '/filters', {
        ...jamaPagination(params),
        project: params.projectId ? jamaId(params.projectId, 'projectId') : undefined,
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
      output: { filters: jamaList(body).map(mapJamaFilter), pageInfo: jamaPageInfo(body) },
    }
  },
  outputs: {
    filters: {
      type: 'array',
      description: 'List Filters result',
      items: { type: 'object', properties: JAMA_FILTER_PROPERTIES },
    },
    pageInfo: JAMA_PAGE_INFO_OUTPUT,
  },
}
