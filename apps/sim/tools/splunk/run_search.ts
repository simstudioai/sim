import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SplunkRunSearchParams, SplunkSearchResultsResponse } from '@/tools/splunk/types'
import {
  buildSplunkFormBody,
  buildSplunkFormHeaders,
  buildSplunkUrl,
  mapSearchResultsPayload,
  normalizeSearchQuery,
  SPLUNK_CONNECTION_PARAMS,
} from '@/tools/splunk/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Bound applied when the caller leaves `maxCount` unset.
 *
 * Splunk's own default is 10000, and a oneshot search has no paging escape
 * hatch — the whole response is buffered and materialized in one call, unlike
 * `get_search_results`, which defaults to 100 and pages with `offset`. A modest
 * default keeps an exploratory search from returning ten thousand rows; callers
 * who want more raise it deliberately.
 */
const RUN_SEARCH_DEFAULT_MAX_COUNT = 1000

/**
 * Resolve the caller-supplied `maxCount`. An untouched subBlock arrives as
 * `null` or `''` rather than `undefined`, and either would otherwise be sent as
 * a literal that Splunk rejects or ignores, so anything that is not a finite
 * number counts as unset.
 */
function resolveMaxCount(value: unknown): number {
  if (value === null || value === undefined || value === '') return RUN_SEARCH_DEFAULT_MAX_COUNT
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : RUN_SEARCH_DEFAULT_MAX_COUNT
}

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
        'Maximum number of results the search stores and returns. Defaults to 1000 here; Splunk itself defaults to 10000, which a oneshot search returns in a single unbounded response. Raise it deliberately.',
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
        max_count: resolveMaxCount(params.maxCount),
      }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return { success: true, output: mapSearchResultsPayload(data) }
  },

  errorExtractor: ErrorExtractorId.SPLUNK_ERRORS,

  /**
   * These fields are written out in full rather than shared with
   * `get_search_results`, which returns the same envelope.
   *
   * `scripts/generate-docs.ts` builds the published output table by parsing tool
   * source text, and resolves an `outputs` const reference only from the tool
   * family's `types.ts`. A shared const declared anywhere else is invisible to
   * it: the whole table falls back to the block's union of every operation's
   * outputs, and unresolved keys inside an inline object are dropped entirely.
   * Moving the const would only relocate that trap, so the duplication is
   * deliberate — keep this literal and the one in `get_search_results.ts` in
   * step by hand.
   */
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
