import type { InternalToolConfig } from '@/tools/types'
import { VANTA_TEST_OUTPUT_PROPERTIES } from '@/tools/vanta/outputs'
import type { VantaGetTestParams, VantaGetTestResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse } from '@/tools/vanta/utils'

export const vantaGetTestTool: InternalToolConfig<VantaGetTestParams, VantaGetTestResponse> = {
  id: 'vanta_get_test',
  name: 'Vanta Get Test',
  description:
    'Get a Vanta automated compliance test by ID, including its status and remediation info',
  version: '1.0.0',

  oauth: { required: true, provider: 'vanta', authoritativeParams: ['apiDomain'] },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token supplied by the saved Vanta credential',
    },
    apiDomain: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'API origin supplied by the saved Vanta credential',
    },
    testId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the test (e.g., test-aws-cloudtrail-enabled)',
    },
  },

  operation: {
    input: (params) => ({
      operation: 'vanta_get_test',
      accessToken: params.accessToken,
      apiDomain: params.apiDomain,
      testId: params.testId,
    }),
  },

  transformResponse: createVantaTransformResponse<VantaGetTestResponse>('Failed to get Vanta test'),

  outputs: {
    test: {
      type: 'json',
      description: 'The requested test',
      properties: VANTA_TEST_OUTPUT_PROPERTIES,
    },
  },
}
