import type { JamaListBaselinesParams, JamaListBaselinesResponse } from '@/tools/jama/types'
import {
  JAMA_BASELINE_PROPERTIES,
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
  mapJamaBaseline,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaListBaselinesTool: ToolConfig<JamaListBaselinesParams, JamaListBaselinesResponse> =
  {
    id: 'jama_list_baselines',
    name: 'Jama List Baselines',
    description: "List Baselines in Jama Connect using the connected user's access permissions.",
    version: '1.0.0',
    oauth: jamaOAuth,
    params: {
      ...jamaAuthParams,
      ...jamaPaginationParams,
      projectId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'project ID',
      },
    },
    request: {
      url: (params) =>
        jamaUrl(params.instanceUrl, '/baselines', {
          ...jamaPagination(params),
          project: jamaId(params.projectId, 'projectId'),
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
        output: { baselines: jamaList(body).map(mapJamaBaseline), pageInfo: jamaPageInfo(body) },
      }
    },
    outputs: {
      baselines: {
        type: 'array',
        description: 'List Baselines result',
        items: { type: 'object', properties: JAMA_BASELINE_PROPERTIES },
      },
      pageInfo: JAMA_PAGE_INFO_OUTPUT,
    },
  }
