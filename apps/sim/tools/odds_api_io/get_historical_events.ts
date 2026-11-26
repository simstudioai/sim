import { toArray } from '@sim/utils/object'
import type {
  OddsApiIoGetHistoricalEventsParams,
  OddsApiIoGetHistoricalEventsResponse,
} from '@/tools/odds_api_io/types'
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

export const oddsApiIoGetHistoricalEventsTool: ToolConfig<
  OddsApiIoGetHistoricalEventsParams,
  OddsApiIoGetHistoricalEventsResponse
> = {
  id: 'odds_api_io_get_historical_events',
  name: 'Odds-API.io Get Historical Events',
  description:
    'List finished events of a league within a date range of up to 31 days, with final scores. History is available from December 2025.',
  version: '1.0.0',
  effect: 'read',
  oauth: oddsApiIoOAuth,
  params: {
    ...oddsApiIoAuthParams,
    sport: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Sport slug (e.g. football, basketball)',
    },
    league: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'League slug (e.g. england-premier-league)',
    },
    from: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start date in RFC 3339 (e.g. 2026-10-01T00:00:00Z)',
    },
    to: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End date in RFC 3339, at most 31 days after the start',
    },
  },
  request: {
    url: (params) =>
      oddsApiIoUrl('/historical/events', params.accessToken, {
        sport: params.sport,
        league: params.league,
        from: params.from,
        to: params.to,
      }),
    method: 'GET',
    headers: () => oddsApiIoHeaders(),
  },
  transformResponse: async (response) => {
    const data = await readOddsApiIoJson(response, 'get historical events')
    return { success: true, output: { events: toArray(data).map(mapEvent) } }
  },
  outputs: {
    events: {
      type: 'array',
      description: 'Finished events in the range',
      items: { type: 'object', properties: EVENT_PROPERTIES },
    },
  },
}
