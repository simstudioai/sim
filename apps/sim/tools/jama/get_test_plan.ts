import type { JamaGetTestPlanParams, JamaGetTestPlanResponse } from '@/tools/jama/types'
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

export const jamaGetTestPlanTool: ToolConfig<JamaGetTestPlanParams, JamaGetTestPlanResponse> = {
  id: 'jama_get_test_plan',
  name: 'Jama Get Test Plan',
  description: "Get Test Plan in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    testPlanId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'testPlan ID',
    },
  },
  request: {
    url: (params) =>
      jamaUrl(params.instanceUrl, `/testplans/${jamaId(params.testPlanId, 'testPlanId')}`, {}),
    method: 'GET',
    headers: jamaHeaders,
    retry: JAMA_RETRY,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response) => {
    const body = await readJamaEnvelope(response)
    return { success: true, output: { testPlan: mapJamaItem(jamaData(body)) } }
  },
  outputs: {
    testPlan: {
      type: 'object',
      description: 'Get Test Plan result',
      properties: JAMA_ITEM_PROPERTIES,
    },
  },
}
