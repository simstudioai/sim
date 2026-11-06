import type { JamaGetTestCycleParams, JamaGetTestCycleResponse } from '@/tools/jama/types'
import {
  JAMA_ITEM_PROPERTIES,
  JAMA_RETRY,
  jamaAuthParams,
  jamaData,
  jamaHeaders,
  jamaId,
  jamaOAuth,
  jamaUrl,
  mapJamaItem,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaGetTestCycleTool: ToolConfig<JamaGetTestCycleParams, JamaGetTestCycleResponse> = {
  id: 'jama_get_test_cycle',
  name: 'Jama Get Test Cycle',
  description: "Get Test Cycle in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    testCycleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'testCycle ID',
    },
  },
  request: {
    url: (params) =>
      jamaUrl(params.instanceUrl, `/testcycles/${jamaId(params.testCycleId, 'testCycleId')}`, {}),
    method: 'GET',
    headers: jamaHeaders,
    retry: JAMA_RETRY,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response) => {
    const body = await readJamaEnvelope(response)
    return { success: true, output: { testCycle: mapJamaItem(jamaData(body)) } }
  },
  outputs: {
    testCycle: {
      type: 'object',
      description: 'Get Test Cycle result',
      properties: JAMA_ITEM_PROPERTIES,
    },
  },
}
