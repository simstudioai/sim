import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SplunkGetSearchResultsParams,
  SplunkSearchResultsResponse,
} from '@/tools/splunk/types'
import {
  buildSplunkHeaders,
  buildSplunkUrl,
  mapSearchResultsPayload,
  readSplunkJson,
  SPLUNK_CONNECTION_PARAMS,
  splunkPathSegment,
} from '@/tools/splunk/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Refuses the `count=0` that Splunk documents as "return all available results".
 *
 * Nothing downstream bounds that read: {@link readSplunkJson} buffers the whole
 * body with a single `response.text()` and every row is then materialized into
 * the block output. The sid is not necessarily a job this workflow dispatched —
 * a scheduled saved search carries `dispatch.max_count`, which defaults to
 * 500000 — so "all" is a number the caller has no way to know in advance.
 *
 * Paging with `offset` reaches the same rows with a bounded response per call,
 * which is what the parameter description directs callers to do.
 */
function assertBoundedResultCount(count: number | undefined): void {
  if (count == null || (count as unknown) === '') return
  if (Number(count) === 0) {
    throw new Error(
      'Splunk reads count=0 as "return every result row", which is unbounded — a scheduled job can hold hundreds of thousands of rows. Set a positive count and page through the results with offset.'
    )
  }
}

/**
 * Reads transformed results from `search/v2/jobs/{sid}/results`. The v1 instance of
 * this endpoint is deprecated and turned off by default from Splunk Enterprise 9.0.1
 * and Splunk Cloud 9.0.2208 onward; both versions return the same JSON envelope
 * (`init_offset`, `messages`, `preview`, `results`).
 */
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
      description:
        'Maximum number of result rows to return. Defaults to 100. Page through larger result sets with offset rather than raising this — a completed job can hold millions of rows. 0 is rejected here even though Splunk reads it as "every row".',
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
      assertBoundedResultCount(params.count)
      const url = buildSplunkUrl(
        params,
        `/search/v2/jobs/${splunkPathSegment(params.sid)}/results`,
        {
          count: params.count,
          offset: params.offset,
          add_summary_to_metadata: params.addSummaryToMetadata,
        }
      )
      const fields = params.fields
        ?.split(',')
        .map((field) => field.trim())
        .filter(Boolean)
      if (!fields?.length) return url
      return `${url}&${fields.map((field) => `f=${encodeURIComponent(field)}`).join('&')}`
    },
    method: 'GET',
    headers: (params) => buildSplunkHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await readSplunkJson(response)
    return { success: true, output: mapSearchResultsPayload(data) }
  },

  errorExtractor: ErrorExtractorId.SPLUNK_ERRORS,

  /** Inline by necessity — see the note on `runSearchTool.outputs`. */
  outputs: {
    results: {
      type: 'array',
      description: 'Result rows. Each row holds the fields produced by the search.',
      items: { type: 'object' },
    },
    resultCount: {
      type: 'number',
      description: 'Number of result rows returned in this response',
    },
    preview: {
      type: 'boolean',
      description: 'Whether these are preview results from a still-running job',
      optional: true,
    },
    initOffset: {
      type: 'number',
      description: 'Offset of the first returned row within the full result set',
      optional: true,
    },
    messages: {
      type: 'array',
      description: 'Search messages returned alongside the results',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Message severity' },
          text: { type: 'string', description: 'Message text' },
        },
      },
    },
  },
}
