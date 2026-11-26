import type { OddsApiIoGetEventParams, OddsApiIoGetEventResponse } from '@/tools/odds_api_io/types'
import {
  EVENT_PROPERTIES,
  mapEvent,
  oddsApiIoAuthParams,
  oddsApiIoHeaders,
  oddsApiIoOAuth,
  oddsApiIoUrl,
  readOddsApiIoJson,
} from '@/tools/odds_api_io/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const oddsApiIoGetEventTool: ToolConfig<OddsApiIoGetEventParams, OddsApiIoGetEventResponse> =
  {
    id: 'odds_api_io_get_event',
    name: 'Odds-API.io Get Event',
    description: 'Get one event by ID, including its status and scores once it is live or settled.',
    version: '1.0.0',
    effect: 'read',
    oauth: oddsApiIoOAuth,
    params: {
      ...oddsApiIoAuthParams,
      eventId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Event ID',
      },
    },
    request: {
      url: (params) =>
        oddsApiIoUrl(
          `/events/${safeUrlPathSegment(params.eventId.trim(), 'eventId')}`,
          params.accessToken
        ),
      method: 'GET',
      headers: () => oddsApiIoHeaders(),
    },
    transformResponse: async (response) => {
      const data = await readOddsApiIoJson(response, 'get event')
      return { success: true, output: { event: mapEvent(data) } }
    },
    outputs: {
      event: { type: 'object', description: 'The event', properties: EVENT_PROPERTIES },
    },
  }
