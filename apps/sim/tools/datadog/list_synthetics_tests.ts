import type {
  ListSyntheticsTestsParams,
  ListSyntheticsTestsResponse,
  SyntheticsTestData,
} from '@/tools/datadog/types'
import { datadogApiUrl, datadogErrorMessage, datadogHeaders } from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const listSyntheticsTestsTool: ToolConfig<
  ListSyntheticsTestsParams,
  ListSyntheticsTestsResponse
> = {
  id: 'datadog_list_synthetics_tests',
  name: 'Datadog List Synthetic Tests',
  description: 'List all Synthetic tests (API, browser, and mobile) with their current status.',
  version: '1.0.0',

  params: {
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of tests returned per page (default: 100)',
    },
    pageNumber: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page to retrieve, starting at zero',
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
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.pageSize !== undefined) queryParams.set('page_size', String(params.pageSize))
      if (params.pageNumber !== undefined) queryParams.set('page_number', String(params.pageNumber))
      const queryString = queryParams.toString()
      return datadogApiUrl(
        params.site,
        `/api/v1/synthetics/tests${queryString ? `?${queryString}` : ''}`
      )
    },
    method: 'GET',
    headers: datadogHeaders,
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { tests: [] },
        error: await datadogErrorMessage(response),
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        tests: (data.tests ?? []).map((test: SyntheticsTestData) => ({
          public_id: test.public_id,
          name: test.name,
          status: test.status,
          type: test.type,
          subtype: test.subtype,
          message: test.message,
          monitor_id: test.monitor_id,
          tags: test.tags ?? [],
          locations: test.locations ?? [],
        })),
      },
    }
  },

  outputs: {
    tests: {
      type: 'array',
      description: 'List of Synthetic tests',
      items: {
        type: 'object',
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
        },
      },
    },
  },
}
