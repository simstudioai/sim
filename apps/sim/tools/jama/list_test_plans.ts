import type { JamaListTestPlansParams, JamaListTestPlansResponse } from '@/tools/jama/types'
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

export const jamaListTestPlansTool: ToolConfig<JamaListTestPlansParams, JamaListTestPlansResponse> =
  {
    id: 'jama_list_test_plans',
    name: 'Jama List Test Plans',
    description: "List Test Plans in Jama Connect using the connected user's access permissions.",
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
        jamaUrl(params.instanceUrl, '/testplans', {
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
        output: { testPlans: jamaList(body).map(mapJamaItem), pageInfo: jamaPageInfo(body) },
      }
    },
    outputs: {
      testPlans: {
        type: 'array',
        description: 'List Test Plans result',
        items: { type: 'object', properties: JAMA_ITEM_PROPERTIES },
      },
      pageInfo: JAMA_PAGE_INFO_OUTPUT,
    },
  }
