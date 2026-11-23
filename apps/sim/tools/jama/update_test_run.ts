import type { JamaUpdateTestRunParams, JamaUpdateTestRunResponse } from '@/tools/jama/types'
import {
  assertJamaResponse,
  JAMA_RETRY,
  jamaAuthParams,
  jamaFields,
  jamaHeaders,
  jamaId,
  jamaOAuth,
  jamaUrl,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaUpdateTestRunTool: ToolConfig<JamaUpdateTestRunParams, JamaUpdateTestRunResponse> =
  {
    id: 'jama_update_test_run',
    name: 'Jama Update Test Run',
    description: "Update Test Run in Jama Connect using the connected user's access permissions.",
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
      fields: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Complete execution fields to update, including testRunStatus, testRunSteps, or executionDate as supported by the item type',
      },
    },
    request: {
      url: (params) =>
        jamaUrl(params.instanceUrl, `/testruns/${jamaId(params.testRunId, 'testRunId')}`, {}),
      method: 'PUT',
      headers: jamaHeaders,
      retry: JAMA_RETRY,
      redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
      body: (params) => ({ fields: jamaFields(params.fields) }),
    },
    transformResponse: async (response) => {
      assertJamaResponse(response)
      return { success: true, output: { status: response.status } }
    },
    outputs: {
      status: { type: 'number', description: 'Successful HTTP status code' },
    },
  }
