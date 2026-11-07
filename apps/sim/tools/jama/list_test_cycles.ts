import type { JamaListTestCyclesParams, JamaListTestCyclesResponse } from '@/tools/jama/types'
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

export const jamaListTestCyclesTool: ToolConfig<
  JamaListTestCyclesParams,
  JamaListTestCyclesResponse
> = {
  id: 'jama_list_test_cycles',
  name: 'Jama List Test Cycles',
  description: "List Test Cycles in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    ...jamaPaginationParams,
    testPlanId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'testPlan ID',
    },
  },
  request: {
    url: (params) =>
      jamaUrl(
        params.instanceUrl,
        `/testplans/${jamaId(params.testPlanId, 'testPlanId')}/testcycles`,
        { ...jamaPagination(params) }
      ),
    method: 'GET',
    headers: jamaHeaders,
    retry: JAMA_RETRY,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response) => {
    const body = await readJamaEnvelope(response)
    return {
      success: true,
      output: { testCycles: jamaList(body).map(mapJamaItem), pageInfo: jamaPageInfo(body) },
    }
  },
  outputs: {
    testCycles: {
      type: 'array',
      description: 'List Test Cycles result',
      items: { type: 'object', properties: JAMA_ITEM_PROPERTIES },
    },
    pageInfo: JAMA_PAGE_INFO_OUTPUT,
  },
}
