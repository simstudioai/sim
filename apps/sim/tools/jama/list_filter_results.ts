import type { JamaListFilterResultsParams, JamaListFilterResultsResponse } from '@/tools/jama/types'
import {
  JAMA_ITEM_PROPERTIES,
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
  mapJamaItem,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaListFilterResultsTool: ToolConfig<
  JamaListFilterResultsParams,
  JamaListFilterResultsResponse
> = {
  id: 'jama_list_filter_results',
  name: 'Jama List Filter Results',
  description: "List Filter Results in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    ...jamaPaginationParams,
    filterId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'filter ID',
    },
    projectId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project ID required for a filter whose projectScope is CURRENT',
    },
  },
  request: {
    url: (params) =>
      jamaUrl(params.instanceUrl, `/filters/${jamaId(params.filterId, 'filterId')}/results`, {
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
      output: { items: jamaList(body).map(mapJamaItem), pageInfo: jamaPageInfo(body) },
    }
  },
  outputs: {
    items: {
      type: 'array',
      description: 'List Filter Results result',
      items: { type: 'object', properties: JAMA_ITEM_PROPERTIES },
    },
    pageInfo: JAMA_PAGE_INFO_OUTPUT,
  },
}
