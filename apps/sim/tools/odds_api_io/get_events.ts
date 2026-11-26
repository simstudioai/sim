import { toArray } from '@sim/utils/object'
import type {
  OddsApiIoGetEventsParams,
  OddsApiIoGetEventsResponse,
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

export const oddsApiIoGetEventsTool: ToolConfig<
  OddsApiIoGetEventsParams,
  OddsApiIoGetEventsResponse
> = {
  id: 'odds_api_io_get_events',
  name: 'Odds-API.io Get Events',
  description:
    'List events of a sport, filtered by league, status, date range or bookmaker. Without a date range, upcoming events for the next 14 days are returned.',
  version: '1.0.0',
  effect: 'read',
  oauth: oddsApiIoOAuth,
  params: {
    ...oddsApiIoAuthParams,
    sport: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Sport slug (e.g. football)',
    },
    league: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'League slug (e.g. england-premier-league)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated event statuses to include (pending, live, settled)',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start of the date range in RFC 3339 (e.g. 2026-11-28T00:00:00Z)',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the date range in RFC 3339. Defaults to 14 days from now.',
    },
    bookmaker: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only events that have odds from this bookmaker (e.g. Bet365)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of events to return (capped at 5000)',
    },
    skip: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Number of events to skip, for pagination',
    },
  },
  request: {
    url: (params) =>
      oddsApiIoUrl('/events', params.accessToken, {
        sport: params.sport,
        league: params.league,
        status: params.status,
        from: params.from,
        to: params.to,
        bookmaker: params.bookmaker,
        limit: params.limit,
        skip: params.skip,
      }),
    method: 'GET',
    headers: () => oddsApiIoHeaders(),
  },
  transformResponse: async (response) => {
    const data = await readOddsApiIoJson(response, 'get events')
    return { success: true, output: { events: toArray(data).map(mapEvent) } }
  },
  outputs: {
    events: {
      type: 'array',
      description: 'Events matching the filters',
      items: { type: 'object', properties: EVENT_PROPERTIES },
    },
  },
}
