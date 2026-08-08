import type {
  DynatraceIngestLogsParams,
  DynatraceIngestLogsResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  parseJsonParam,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const ingestLogsTool: ToolConfig<DynatraceIngestLogsParams, DynatraceIngestLogsResponse> = {
  id: 'dynatrace_ingest_logs',
  name: 'Dynatrace Ingest Logs',
  description:
    'Push log events into Dynatrace. Accepts a single log event object or an array of them.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.DYNATRACE_ERRORS,

  params: {
    environmentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Dynatrace environment URL (e.g., https://abc12345.live.dynatrace.com, or https://your-activegate:9999/e/abc12345 for Managed)',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dynatrace access token (dt0c01...) with the logs.ingest scope',
    },
    logs: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'A log event object, or an array of them. Recognized keys are content, timestamp, and severity; any other key becomes a custom attribute (e.g. [{"content":"Deploy finished","severity":"info","service":"checkout"}])',
    },
  },

  request: {
    url: (params) => buildDynatraceUrl(params.environmentUrl, '/logs/ingest'),
    method: 'POST',
    headers: (params) => dynatraceHeaders(params.apiToken),
    body: (params) => {
      const logs = parseJsonParam(params.logs)
      // Dynatrace answers 204 for an empty array, which would report a send that
      // never happened as a success. Fail loudly instead.
      if (logs === undefined || (Array.isArray(logs) && logs.length === 0)) {
        throw new Error('logs must contain at least one log event')
      }
      return JSON.stringify(logs)
    },
  },

  /** Ingestion answers 204 with no body, or 200 with a partial-success body. */
  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)
    const hasDetails = Object.keys(data).length > 0

    return {
      success: true,
      output: {
        accepted: response.status === 204,
        statusCode: response.status,
        details: hasDetails ? data : null,
      },
    }
  },

  outputs: {
    accepted: {
      type: 'boolean',
      description: 'True when Dynatrace accepted every log event (HTTP 204)',
    },
    statusCode: {
      type: 'number',
      description: 'HTTP status Dynatrace returned. 204 is full success, 200 is partial success',
    },
    details: {
      type: 'json',
      description:
        'Partial-success body, present only when some events were rejected. The reference does not document its shape, so it is passed through as-is',
      nullable: true,
    },
  },
}
