import type { SplunkRunSearchParams, SplunkSearchResultsResponse } from '@/tools/splunk/types'
import {
  buildSplunkFormBody,
  buildSplunkFormHeaders,
  buildSplunkUrl,
  mapSearchResultsPayload,
  normalizeSearchQuery,
  SEARCH_RESULTS_OUTPUTS,
  SPLUNK_CONNECTION_PARAMS,
} from '@/tools/splunk/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Runs SPL with `exec_mode=oneshot`, the documented synchronous mode in which
 * `POST search/jobs` returns the results directly instead of a search ID.
 */
export const runSearchTool: ToolConfig<SplunkRunSearchParams, SplunkSearchResultsResponse> = {
  id: 'splunk_run_search',
  name: 'Splunk Run Search',
  description:
    'Run an SPL search synchronously and return its results in a single call (oneshot mode). Use for short searches; use Create Search Job for long-running ones.',
  version: '1.0.0',

  params: {
    ...SPLUNK_CONNECTION_PARAMS,
    search: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'SPL search string (e.g. index=main error | stats count by host). The leading "search" command is added automatically when omitted.',
    },
    earliestTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Earliest (inclusive) time bound — relative (e.g. -24h, -7d@d) or absolute epoch/formatted time',
    },
    latestTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Latest (exclusive) time bound — relative (e.g. now) or absolute time',
    },
    adhocSearchLevel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search mode: verbose, fast, or smart. Defaults to fast.',
    },
    autoCancel: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Cancel the search after this many seconds of inactivity (e.g. 60). 0 never auto-cancels.',
    },
    maxCount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Maximum number of results the search stores and returns. Defaults to 10000. Lower it to bound large oneshot responses.',
    },
  },

  request: {
    url: (params) => buildSplunkUrl(params, '/search/jobs'),
    method: 'POST',
    headers: (params) => buildSplunkFormHeaders(params),
    body: (params) =>
      buildSplunkFormBody({
        search: normalizeSearchQuery(params.search),
        exec_mode: 'oneshot',
        output_mode: 'json',
        earliest_time: params.earliestTime,
        latest_time: params.latestTime,
        adhoc_search_level: params.adhocSearchLevel,
        auto_cancel: params.autoCancel,
        max_count: params.maxCount,
      }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: mapSearchResultsPayload(data) }
  },

  outputs: SEARCH_RESULTS_OUTPUTS,
}
