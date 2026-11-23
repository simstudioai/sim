import type { JamaListTestRunsParams, JamaListTestRunsResponse } from '@/tools/jama/types'
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

export const jamaListTestRunsTool: ToolConfig<JamaListTestRunsParams, JamaListTestRunsResponse> = {
  id: 'jama_list_test_runs',
  name: 'Jama List Test Runs',
  description: "List Test Runs in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    ...jamaPaginationParams,
    testCycleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'testCycle ID',
    },
  },
  request: {
    url: (params) =>
      jamaUrl(
        params.instanceUrl,
        `/testcycles/${jamaId(params.testCycleId, 'testCycleId')}/testruns`,
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
      output: { testRuns: jamaList(body).map(mapJamaItem), pageInfo: jamaPageInfo(body) },
    }
  },
  outputs: {
    testRuns: {
      type: 'array',
      description: 'List Test Runs result',
      items: { type: 'object', properties: JAMA_ITEM_PROPERTIES },
    },
    pageInfo: JAMA_PAGE_INFO_OUTPUT,
  },
}
