import { ErrorExtractorId } from '@/tools/error-extractors'
import type { SplunkGetSearchJobParams, SplunkGetSearchJobResponse } from '@/tools/splunk/types'
import {
  asBoolean,
  asNumber,
  asString,
  buildSplunkHeaders,
  buildSplunkUrl,
  getEntryContent,
  getSplunkEntries,
  SPLUNK_CONNECTION_PARAMS,
  splunkPathSegment,
} from '@/tools/splunk/utils'
import type { ToolConfig } from '@/tools/types'

export const getSearchJobTool: ToolConfig<SplunkGetSearchJobParams, SplunkGetSearchJobResponse> = {
  id: 'splunk_get_search_job',
  name: 'Splunk Get Search Job',
  description:
    'Get the status and progress of a Splunk search job by search ID, including dispatch state, completion progress, and event/result counts.',
  version: '1.0.0',

  params: {
    ...SPLUNK_CONNECTION_PARAMS,
    sid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search ID of the job to inspect (e.g. 1457683115.100)',
    },
  },

  request: {
    url: (params) => buildSplunkUrl(params, `/search/jobs/${splunkPathSegment(params.sid)}`),
    method: 'GET',
    headers: (params) => buildSplunkHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const entries = getSplunkEntries(data)
    const content =
      entries.length > 0 ? getEntryContent(entries[0]) : (data as Record<string, unknown>)

    return {
      success: true,
      output: {
        sid: asString(content.sid),
        label: asString(content.label),
        dispatchState: asString(content.dispatchState),
        doneProgress: asNumber(content.doneProgress),
        isDone: asBoolean(content.isDone),
        isFailed: asBoolean(content.isFailed),
        isFinalized: asBoolean(content.isFinalized),
        isPaused: asBoolean(content.isPaused),
        isZombie: asBoolean(content.isZombie),
        isSaved: asBoolean(content.isSaved),
        isSavedSearch: asBoolean(content.isSavedSearch),
        isRealTimeSearch: asBoolean(content.isRealTimeSearch),
        eventCount: asNumber(content.eventCount),
        eventAvailableCount: asNumber(content.eventAvailableCount),
        eventFieldCount: asNumber(content.eventFieldCount),
        resultCount: asNumber(content.resultCount),
        resultPreviewCount: asNumber(content.resultPreviewCount),
        scanCount: asNumber(content.scanCount),
        runDuration: asNumber(content.runDuration),
        priority: asNumber(content.priority),
        earliestTime: asString(content.earliestTime),
        latestTime: asString(content.latestTime),
        searchEarliestTime: asNumber(content.searchEarliestTime),
        searchLatestTime: asNumber(content.searchLatestTime),
        messages: (content.messages as Record<string, unknown>) ?? null,
      },
    }
  },

  errorExtractor: ErrorExtractorId.SPLUNK_ERRORS,

  outputs: {
    sid: { type: 'string', description: 'Search ID of the job', optional: true },
    label: { type: 'string', description: 'Custom name created for this search', optional: true },
    dispatchState: {
      type: 'string',
      description:
        'Job state: QUEUED, PARSING, RUNNING, FINALIZING, PAUSE, INTERNAL_CANCEL, USER_CANCEL, BAD_INPUT_CANCEL, QUIT, FAILED, or DONE',
      optional: true,
    },
    doneProgress: {
      type: 'number',
      description: 'Approximate progress between 0 and 1.0',
      optional: true,
    },
    isDone: { type: 'boolean', description: 'Whether the search has completed', optional: true },
    isFailed: {
      type: 'boolean',
      description: 'Whether a fatal error occurred running the search',
      optional: true,
    },
    isFinalized: {
      type: 'boolean',
      description: 'Whether the search was finalized (stopped before completion)',
      optional: true,
    },
    isPaused: { type: 'boolean', description: 'Whether the search is paused', optional: true },
    isZombie: {
      type: 'boolean',
      description: 'Whether the search process died before the search finished',
      optional: true,
    },
    isSaved: {
      type: 'boolean',
      description: 'Whether the search job artifacts are saved to disk',
      optional: true,
    },
    isSavedSearch: {
      type: 'boolean',
      description: 'Whether this is a saved search run by the scheduler',
      optional: true,
    },
    isRealTimeSearch: {
      type: 'boolean',
      description: 'Whether this is a real-time search',
      optional: true,
    },
    eventCount: {
      type: 'number',
      description: 'Number of events returned by the search',
      optional: true,
    },
    eventAvailableCount: {
      type: 'number',
      description: 'Number of events available for export',
      optional: true,
    },
    eventFieldCount: {
      type: 'number',
      description: 'Number of fields found in the search results',
      optional: true,
    },
    resultCount: {
      type: 'number',
      description: 'Total number of results returned by the search',
      optional: true,
    },
    resultPreviewCount: {
      type: 'number',
      description: 'Number of result rows in the latest preview results',
      optional: true,
    },
    scanCount: {
      type: 'number',
      description: 'Number of events scanned or read off disk',
      optional: true,
    },
    runDuration: {
      type: 'number',
      description: 'Time in seconds the search took to complete',
      optional: true,
    },
    priority: { type: 'number', description: 'Search priority between 0 and 10', optional: true },
    earliestTime: {
      type: 'string',
      description: 'Earliest (inclusive) time bound for the search',
      optional: true,
    },
    latestTime: {
      type: 'string',
      description: 'Latest (exclusive) time bound for the search',
      optional: true,
    },
    searchEarliestTime: {
      type: 'number',
      description:
        'Earliest time as specified in the search command itself, as an epoch timestamp. Unlike earliestTime, which the job entry renders as an ISO string, this pair is documented as bare numbers (e.g. 1308589800.000000000).',
      optional: true,
    },
    searchLatestTime: {
      type: 'number',
      description:
        'Latest time as specified in the search command itself, as an epoch timestamp. Unlike latestTime, which the job entry renders as an ISO string, this pair is documented as bare numbers.',
      optional: true,
    },
    messages: {
      type: 'json',
      description: 'Errors and debug messages recorded for the job',
      optional: true,
    },
  },
}
