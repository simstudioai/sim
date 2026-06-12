import type { ToolConfig } from '@/tools/types'
import { VANTA_TEST_OUTPUT_PROPERTIES } from '@/tools/vanta/outputs'
import type { VantaGetTestParams, VantaGetTestResponse } from '@/tools/vanta/types'
import { createVantaTransformResponse, VANTA_QUERY_ROUTE } from '@/tools/vanta/utils'

export const vantaGetTestTool: ToolConfig<VantaGetTestParams, VantaGetTestResponse> = {
  id: 'vanta_get_test',
  name: 'Vanta Get Test',
  description:
    'Get a Vanta automated compliance test by ID, including its status and remediation info',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Vanta OAuth application client secret',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Vanta API region: "us" (api.vanta.com, default) or "gov" (api.vanta-gov.com)',
    },
    testId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique ID of the test (e.g., test-aws-cloudtrail-enabled)',
    },
  },

  request: {
    url: VANTA_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'vanta_get_test',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      region: params.region,
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
