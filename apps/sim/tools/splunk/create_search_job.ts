import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SplunkCreateSearchJobParams,
  SplunkCreateSearchJobResponse,
} from '@/tools/splunk/types'
import {
  buildSplunkFormBody,
  buildSplunkFormHeaders,
  buildSplunkUrl,
  normalizeSearchQuery,
  readSplunkDispatchJson,
  requireSplunkSid,
  SPLUNK_CONNECTION_PARAMS,
} from '@/tools/splunk/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * `exec_mode` accepts `blocking | oneshot | normal`, but of those only the two that
 * return a search ID belong on this tool — the reference says oneshot "returns results
 * in the same call" and "Does not return the search ID". Reject it before the search
 * runs rather than letting Splunk execute it and returning a null sid.
 */
function resolveExecMode(execMode: string | undefined): string {
  const mode = execMode?.trim().toLowerCase()
  if (!mode) return 'normal'
  if (mode === 'oneshot') {
    throw new Error(
      'Splunk Create Search Job cannot use exec_mode=oneshot because that mode returns results instead of a search ID. Use the Splunk Run Search operation instead.'
    )
  }
  if (mode !== 'normal' && mode !== 'blocking') {
    throw new Error(`Invalid Splunk execution mode "${execMode}". Use normal or blocking.`)
  }
  return mode
}

/**
 * Starts an asynchronous search job and returns its search ID (sid). Poll the job
 * with Get Search Job, then read rows with Get Search Results.
 */
export const createSearchJobTool: ToolConfig<
  SplunkCreateSearchJobParams,
  SplunkCreateSearchJobResponse
> = {
  id: 'splunk_create_search_job',
  name: 'Splunk Create Search Job',
  description:
    'Start a Splunk search job and return its search ID (sid). The search runs asynchronously — poll its status and fetch results separately.',
  version: '1.0.0',

  params: {
    ...SPLUNK_CONNECTION_PARAMS,
    search: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'SPL search string (e.g. index=main sourcetype=access_combined | timechart count). The leading "search" command is added automatically when omitted.',
    },
    earliestTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Earliest (inclusive) time bound — relative (e.g. -24h) or absolute time',
    },
    latestTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Latest (exclusive) time bound — relative (e.g. now) or absolute time',
    },
    execMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Execution mode: normal (returns the sid immediately) or blocking (returns the sid once the job completes). Defaults to normal. oneshot is rejected here because it returns results instead of a sid — use Splunk Run Search for that.',
    },
    adhocSearchLevel: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search mode: verbose, fast, or smart. Defaults to fast.',
    },
    searchId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom search ID to assign to the job. A random ID is generated when omitted.',
    },
    indexEarliest: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Earliest (inclusive) time bound based on index time rather than event time',
    },
    indexLatest: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Latest (exclusive) time bound based on index time rather than event time',
    },
    enableLookups: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether lookups are applied to events. Defaults to true.',
    },
    allowPartialResults: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the job may return partial results when a search peer fails. Defaults to true.',
    },
    autoCancel: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Cancel the job after this many seconds of inactivity (e.g. 300). 0 never auto-cancels.',
    },
    maxCount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Number of events accessible in any given status bucket, and in transforming mode the maximum number of results to store. Defaults to 10000.',
    },
  },

  request: {
    url: (params) => buildSplunkUrl(params, '/search/jobs'),
    method: 'POST',
    headers: (params) => buildSplunkFormHeaders(params),
    body: (params) =>
      buildSplunkFormBody({
        search: normalizeSearchQuery(params.search),
        output_mode: 'json',
        exec_mode: resolveExecMode(params.execMode),
        earliest_time: params.earliestTime,
        latest_time: params.latestTime,
        adhoc_search_level: params.adhocSearchLevel,
        id: params.searchId,
        index_earliest: params.indexEarliest,
        index_latest: params.indexLatest,
        enable_lookups: params.enableLookups,
        allow_partial_results: params.allowPartialResults,
        auto_cancel: params.autoCancel,
        max_count: params.maxCount,
      }),
  },

  transformResponse: async (response: Response) => {
    const data = await readSplunkDispatchJson(response)
    return { success: true, output: { sid: requireSplunkSid(data) } }
  },

  errorExtractor: ErrorExtractorId.SPLUNK_ERRORS,

  outputs: {
    sid: {
      type: 'string',
      description: 'Search ID of the created job, used to poll status and fetch results',
    },
  },
}
