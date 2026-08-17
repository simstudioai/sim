import type { GetSyntheticsTestParams, GetSyntheticsTestResponse } from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  datadogPathSegment,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const getSyntheticsTestTool: ToolConfig<GetSyntheticsTestParams, GetSyntheticsTestResponse> =
  {
    id: 'datadog_get_synthetics_test',
    name: 'Datadog Get Synthetic Test',
    description:
      'Get the configuration of a Synthetic test by public ID. Browser test steps are not included by this type-agnostic endpoint.',
    version: '1.0.0',

    params: {
      publicId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The public ID of the Synthetic test (e.g., "abc-def-ghi")',
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
      url: (params) =>
        datadogApiUrl(
          params.site,
          `/api/v1/synthetics/tests/${datadogPathSegment(params.publicId)}`
        ),
      method: 'GET',
      headers: datadogHeaders,
    },

    transformResponse: async (response: Response) => {
      if (!response.ok) {
        return {
          success: false,
          output: { test: {} },
          error: await datadogErrorMessage(response),
        }
      }

      return {
        success: true,
        output: { test: await response.json() },
      }
    },

    outputs: {
      test: {
        type: 'object',
        description: 'The Synthetic test configuration',
        properties: {
          public_id: { type: 'string', description: 'Public ID of the test' },
          name: { type: 'string', description: 'Test name' },
          status: { type: 'string', description: 'Pause status: live or paused' },
          type: { type: 'string', description: 'Test type: api, browser, mobile, or network' },
          subtype: { type: 'string', description: 'Test subtype, such as http or ssl' },
          message: { type: 'string', description: 'Notification message' },
          monitor_id: { type: 'number', description: 'Associated monitor ID' },
          tags: { type: 'array', description: 'Tags attached to the test' },
          locations: { type: 'array', description: 'Locations the test runs from' },
          config: { type: 'object', description: 'Test request, assertions, and variables' },
          options: { type: 'object', description: 'Scheduling, retry, and monitor options' },
          creator: { type: 'object', description: 'User who created the test' },
        },
      },
    },
  }
