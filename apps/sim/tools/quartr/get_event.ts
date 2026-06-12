import {
  QUARTR_EVENT_OUTPUT_PROPERTIES,
  type QuartrEventDto,
  type QuartrGetEventParams,
  type QuartrGetEventResponse,
  type QuartrSingleDto,
} from '@/tools/quartr/types'
import { buildQuartrUrl, mapQuartrEvent, parseQuartrResponse } from '@/tools/quartr/utils'
import type { ToolConfig } from '@/tools/types'

export const quartrGetEventTool: ToolConfig<QuartrGetEventParams, QuartrGetEventResponse> = {
  id: 'quartr_get_event',
  name: 'Quartr Get Event',
  description: 'Retrieve a single corporate event from Quartr by its event ID.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Quartr API key',
    },
    eventId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Quartr event ID (e.g., 128301)',
    },
  },

  request: {
    url: (params) => buildQuartrUrl(`/events/${encodeURIComponent(String(params.eventId).trim())}`),
    method: 'GET',
    headers: (params) => ({ 'x-api-key': params.apiKey }),
  },

  transformResponse: async (response) => {
    const data = await parseQuartrResponse<QuartrSingleDto<QuartrEventDto>>(response, 'get event')

    return {
      success: true,
      output: {
        event: mapQuartrEvent(data.data),
      },
    }
  },

  outputs: {
    event: {
      type: 'object',
      description: 'The requested event',
      properties: QUARTR_EVENT_OUTPUT_PROPERTIES,
    },
  },
}
