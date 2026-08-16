import type {
  GetBrowserSyntheticsResultsParams,
  GetBrowserSyntheticsResultsResponse,
} from '@/tools/datadog/types'
import {
  datadogApiUrl,
  datadogErrorMessage,
  datadogHeaders,
  datadogPathSegment,
  splitCommaList,
} from '@/tools/datadog/utils'
import type { ToolConfig } from '@/tools/types'

export const getBrowserSyntheticsResultsTool: ToolConfig<
  GetBrowserSyntheticsResultsParams,
  GetBrowserSyntheticsResultsResponse
> = {
  id: 'datadog_get_browser_synthetics_results',
  name: 'Datadog Get Browser Synthetic Test Results',
  description:
    'Get the latest result summaries (up to the last 150 runs) for a Synthetic browser test, including step counts and errors.',
  version: '1.0.0',

  params: {
    publicId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The public ID of the Synthetic browser test',
    },
    fromTs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timestamp in milliseconds from which to start querying results',
    },
    toTs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timestamp in milliseconds up to which to query results',
    },
    probeDc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated locations to query results for (e.g., "aws:eu-west-3")',
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
      if (params.fromTs !== undefined) queryParams.set('from_ts', String(params.fromTs))
      if (params.toTs !== undefined) queryParams.set('to_ts', String(params.toTs))
      for (const location of splitCommaList(params.probeDc) ?? []) {
        queryParams.append('probe_dc', location)
      }
      const queryString = queryParams.toString()
      return datadogApiUrl(
        params.site,
        `/api/v1/synthetics/tests/browser/${datadogPathSegment(params.publicId)}/results${
          queryString ? `?${queryString}` : ''
        }`
      )
    },
    method: 'GET',
    headers: datadogHeaders,
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        output: { results: [] },
        error: await datadogErrorMessage(response),
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        results: data.results ?? [],
        lastTimestampFetched: data.last_timestamp_fetched,
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Latest browser test result summaries',
      items: {
        type: 'object',
        properties: {
          result_id: { type: 'string', description: 'ID of the browser test result' },
          check_time: { type: 'number', description: 'Time the browser test ran' },
          probe_dc: { type: 'string', description: 'Location the browser test ran from' },
          status: {
            type: 'number',
            description: 'Monitor status: 0 not triggered, 1 triggered, 2 no data',
          },
          result: {
            type: 'object',
            description: 'Run outcome',
            properties: {
              duration: { type: 'number', description: 'Length of the run in milliseconds' },
              errorCount: { type: 'number', description: 'Number of errors collected in the run' },
              stepCountCompleted: {
                type: 'number',
                description: 'Steps completed before failing',
              },
              stepCountTotal: { type: 'number', description: 'Total number of steps' },
              device: { type: 'object', description: 'Device the run was performed on' },
            },
          },
        },
      },
    },
    lastTimestampFetched: {
      type: 'number',
      description: 'Timestamp of the latest browser test run',
      optional: true,
    },
  },
}
