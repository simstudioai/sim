import type { JamaGetTestRunParams, JamaGetTestRunResponse } from '@/tools/jama/types'
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

export const jamaGetTestRunTool: ToolConfig<JamaGetTestRunParams, JamaGetTestRunResponse> = {
  id: 'jama_get_test_run',
  name: 'Jama Get Test Run',
  description: "Get Test Run in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    testRunId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'testRun ID',
    },
  },
  request: {
    url: (params) =>
      jamaUrl(params.instanceUrl, `/testruns/${jamaId(params.testRunId, 'testRunId')}`, {}),
    method: 'GET',
    headers: jamaHeaders,
    retry: JAMA_RETRY,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response) => {
    const body = await readJamaEnvelope(response)
    return { success: true, output: { testRun: mapJamaItem(jamaData(body)) } }
  },
  outputs: {
    testRun: {
      type: 'object',
      description: 'Get Test Run result',
      properties: JAMA_ITEM_PROPERTIES,
    },
  },
}
