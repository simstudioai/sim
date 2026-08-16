import type {
  TriggerSyntheticsTestsParams,
  TriggerSyntheticsTestsResponse,
} from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  splitCommaList,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerSyntheticsTestsTool: ToolConfig<
  TriggerSyntheticsTestsParams,
  TriggerSyntheticsTestsResponse
> = {
  id: 'datadog_trigger_synthetics_tests',
  name: 'Datadog Trigger Synthetic Tests',
  description: 'Trigger an immediate run of one or more Synthetic tests by public ID.',
  version: '1.0.0',

  params: {
    publicIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated public IDs of the Synthetic tests to trigger',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog API key',
    },
    applicationKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datadog Application key',
    },
    site: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Datadog site/region (default: datadoghq.com)',
    },
  },

  request: {
    url: (params) => datadogApiUrl(params.site, '/api/v1/synthetics/tests/trigger'),
    method: 'POST',
    headers: datadogHeaders,
    body: (params) => ({
      tests: (splitCommaList(params.publicIds) ?? []).map((publicId) => ({
        public_id: publicId,
      })),
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { triggeredCheckIds: [], results: [], locations: [] },
        error: await datadogErrorMessage(response),
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        batchId: data.batch_id,
        triggeredCheckIds: data.triggered_check_ids ?? [],
        results: data.results ?? [],
        locations: data.locations ?? [],
      },
    }
  },

  outputs: {
    batchId: {
      type: 'string',
      description: 'Public ID of the triggered batch',
      optional: true,
    },
    triggeredCheckIds: {
      type: 'array',
      description: 'Public IDs of the triggered Synthetic tests',
      items: { type: 'string' },
    },
    results: {
      type: 'array',
      description: 'Information about each triggered test run',
      items: {
        type: 'object',
        properties: {
          public_id: { type: 'string', description: 'Public ID of the test' },
          result_id: { type: 'string', description: 'ID of the run result' },
          location: { type: 'number', description: 'Location ID of the run' },
          device: { type: 'string', description: 'Device ID used for browser tests' },
        },
      },
    },
    locations: {
      type: 'array',
      description: 'Locations the tests were triggered from',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Location ID' },
          name: { type: 'string', description: 'Location name' },
        },
      },
    },
  },
}
