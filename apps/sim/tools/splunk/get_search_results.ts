import type {
  SplunkGetSearchResultsParams,
  SplunkSearchResultsResponse,
} from '@/tools/splunk/types'
import {
  buildSplunkHeaders,
  buildSplunkUrl,
  mapSearchResultsPayload,
  SEARCH_RESULTS_OUTPUTS,
  SPLUNK_CONNECTION_PARAMS,
} from '@/tools/splunk/utils'
import type { ToolConfig } from '@/tools/types'

export const getSearchResultsTool: ToolConfig<
  SplunkGetSearchResultsParams,
  SplunkSearchResultsResponse
> = {
  id: 'splunk_get_search_results',
  name: 'Splunk Get Search Results',
  description:
    'Fetch the transformed results of a completed Splunk search job by search ID, with pagination.',
  version: '1.0.0',

  params: {
    ...SPLUNK_CONNECTION_PARAMS,
    sid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search ID of the job whose results to fetch (e.g. 1457683115.100)',
    },
    count: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of result rows to return (e.g. 100). 0 returns all rows.',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'First result row (0-indexed) from which to begin returning data',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated list of fields to return for each row (e.g. _time,host,source). Returns all fields when omitted.',
    },
    addSummaryToMetadata: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include field summary statistics in the response',
    },
  },

  request: {
    url: (params) => {
      const url = buildSplunkUrl(params, `/search/jobs/${encodeURIComponent(params.sid)}/results`, {
        count: params.count,
        offset: params.offset,
        add_summary_to_metadata: params.addSummaryToMetadata,
      })
      const fields = params.fields
        ?.split(',')
        .map((field) => field.trim())
        .filter(Boolean)
      if (!fields?.length) return url
      // `f` is repeatable — one occurrence per requested field.
      return `${url}&${fields.map((field) => `f=${encodeURIComponent(field)}`).join('&')}`
    },
    method: 'GET',
    headers: (params) => buildSplunkHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: mapSearchResultsPayload(data) }
  },

  outputs: SEARCH_RESULTS_OUTPUTS,
}
