import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SplunkDispatchSavedSearchParams,
  SplunkDispatchSavedSearchResponse,
} from '@/tools/splunk/types'
import {
  buildSplunkFormBody,
  buildSplunkFormHeaders,
  buildSplunkUrl,
  readSplunkDispatchJson,
  requireSplunkSid,
  SPLUNK_CONNECTION_PARAMS,
  splunkPathSegment,
} from '@/tools/splunk/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Runs a saved search immediately. Like any dispatched search this is asynchronous:
 * the endpoint returns the new job's search ID, which Get Search Job and Get Search
 * Results then consume. The REST reference documents the response only in its XML form,
 * `<response><sid>...</sid></response>`; that `output_mode=json` renders it as a flat
 * `{ "sid": "..." }`, matching `POST search/jobs`, is an inference the reference does not
 * state outright. `requireSplunkSid` therefore fails loudly rather than reporting success
 * with a null sid if the body arrives in some other shape.
 */
export const dispatchSavedSearchTool: ToolConfig<
  SplunkDispatchSavedSearchParams,
  SplunkDispatchSavedSearchResponse
> = {
  id: 'splunk_dispatch_saved_search',
  name: 'Splunk Dispatch Saved Search',
  description:
    'Run a Splunk saved search immediately and return the search ID (sid) of the dispatched job.',
  version: '1.0.0',

  params: {
    ...SPLUNK_CONNECTION_PARAMS,
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the saved search to run (e.g. Errors in the last 24 hours)',
    },
    triggerActions: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to trigger the saved search alert actions on this run',
    },
    dispatchEarliestTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Override the earliest time bound for this run — relative (e.g. -24h) or absolute time',
    },
    dispatchLatestTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Override the latest time bound for this run — relative (e.g. now) or absolute time',
    },
    dispatchMaxCount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results before the search is finalized (e.g. 10000)',
    },
    dispatchMaxTime: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of seconds before the search is finalized (e.g. 300)',
    },
    dispatchTtl: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Time to live in seconds for the search artifacts when no actions are triggered (e.g. 600)',
    },
    forceDispatch: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start a new search even when another instance of this saved search is already running',
    },
  },

  request: {
    url: (params) =>
      buildSplunkUrl(params, `/saved/searches/${splunkPathSegment(params.name)}/dispatch`),
    method: 'POST',
    headers: (params) => buildSplunkFormHeaders(params),
    body: (params) =>
      buildSplunkFormBody({
        output_mode: 'json',
        trigger_actions: params.triggerActions,
        force_dispatch: params.forceDispatch,
        'dispatch.earliest_time': params.dispatchEarliestTime,
        'dispatch.latest_time': params.dispatchLatestTime,
        'dispatch.max_count': params.dispatchMaxCount,
        'dispatch.max_time': params.dispatchMaxTime,
        'dispatch.ttl': params.dispatchTtl,
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
      description: 'Search ID of the dispatched job, used to poll status and fetch results',
    },
  },
}
