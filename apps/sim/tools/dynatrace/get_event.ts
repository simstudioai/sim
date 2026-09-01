import { eventProperties } from '@/tools/dynatrace/outputs'
import type { DynatraceGetEventParams, DynatraceGetEventResponse } from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  encodeDynatraceId,
  mapEvent,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const getEventTool: ToolConfig<DynatraceGetEventParams, DynatraceGetEventResponse> = {
  id: 'dynatrace_get_event',
  name: 'Dynatrace Get Event',
  description: 'Get the full details of a single Dynatrace event.',
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
      description: 'Dynatrace access token (dt0c01...) with the events.read scope',
    },
    eventId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the event',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(params.environmentUrl, `/events/${encodeDynatraceId(params.eventId)}`),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)

    return {
      success: true,
      output: {
        event: mapEvent(data),
      },
    }
  },

  outputs: {
    event: {
      type: 'object',
      description: 'The requested event',
      properties: eventProperties,
    },
  },
}
