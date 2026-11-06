import type { JamaGetBaselineParams, JamaGetBaselineResponse } from '@/tools/jama/types'
import {
  JAMA_BASELINE_PROPERTIES,
  JAMA_RETRY,
  jamaAuthParams,
  jamaData,
  jamaHeaders,
  jamaId,
  jamaOAuth,
  jamaUrl,
  mapJamaBaseline,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaGetBaselineTool: ToolConfig<JamaGetBaselineParams, JamaGetBaselineResponse> = {
  id: 'jama_get_baseline',
  name: 'Jama Get Baseline',
  description: "Get Baseline in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    baselineId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'baseline ID',
    },
  },
  request: {
    url: (params) =>
      jamaUrl(params.instanceUrl, `/baselines/${jamaId(params.baselineId, 'baselineId')}`, {}),
    method: 'GET',
    headers: jamaHeaders,
    retry: JAMA_RETRY,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response) => {
    const body = await readJamaEnvelope(response)
    return { success: true, output: { baseline: mapJamaBaseline(jamaData(body)) } }
  },
  outputs: {
    baseline: {
      type: 'object',
      description: 'Get Baseline result',
      properties: JAMA_BASELINE_PROPERTIES,
    },
  },
}
