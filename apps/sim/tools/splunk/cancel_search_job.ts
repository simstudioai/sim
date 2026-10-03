import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  SplunkCancelSearchJobParams,
  SplunkCancelSearchJobResponse,
} from '@/tools/splunk/types'
import {
  buildSplunkFormBody,
  buildSplunkFormHeaders,
  buildSplunkUrl,
  mapSplunkMessages,
  readSplunkDispatchJson,
  SPLUNK_CONNECTION_PARAMS,
  splunkPathSegment,
} from '@/tools/splunk/utils'
import type { ToolConfig } from '@/tools/types'

/** Stops a search job and deletes its result cache via the job control endpoint. */
export const cancelSearchJobTool: ToolConfig<
  SplunkCancelSearchJobParams,
  SplunkCancelSearchJobResponse
> = {
  id: 'splunk_cancel_search_job',
  name: 'Splunk Cancel Search Job',
  description: 'Cancel a running Splunk search job and delete its result cache.',
  version: '1.0.0',

  params: {
    ...SPLUNK_CONNECTION_PARAMS,
    sid: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search ID of the job to cancel (e.g. 1457683115.100)',
    },
  },

  request: {
    url: (params) =>
      buildSplunkUrl(params, `/search/jobs/${splunkPathSegment(params.sid)}/control`),
    method: 'POST',
    headers: (params) => buildSplunkFormHeaders(params),
    body: () => buildSplunkFormBody({ action: 'cancel' }),
  },

  transformResponse: async (response: Response, params) => {
    const data = await readSplunkDispatchJson(response)
    return {
      success: true,
      output: {
        sid: params?.sid ?? '',
        messages: mapSplunkMessages((data as { messages?: unknown })?.messages),
      },
    }
  },

  errorExtractor: ErrorExtractorId.SPLUNK_ERRORS,

  /** Inline by necessity — see the note on `runSearchTool.outputs`. */
  outputs: {
    sid: { type: 'string', description: 'Search ID of the cancelled job' },
    messages: {
      type: 'array',
      description: 'Informational, warning, and error messages returned with the response',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Message severity (INFO, WARN, ERROR, DEBUG)' },
          text: { type: 'string', description: 'Message text' },
        },
      },
    },
  },
}
