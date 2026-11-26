import { toArray } from '@sim/utils/object'
import type {
  OddsApiIoSearchEventsParams,
  OddsApiIoSearchEventsResponse,
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

export const oddsApiIoSearchEventsTool: ToolConfig<
  OddsApiIoSearchEventsParams,
  OddsApiIoSearchEventsResponse
> = {
  id: 'odds_api_io_search_events',
  name: 'Odds-API.io Search Events',
  description:
    'Search upcoming or live events by team or league name and get up to 10 results ranked by relevance.',
  version: '1.0.0',
  effect: 'read',
  oauth: oddsApiIoOAuth,
  params: {
    ...oddsApiIoAuthParams,
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Team or league name to search for (at least 3 characters)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Which events to search: upcoming (default) or live',
    },
  },
  request: {
    url: (params) =>
      oddsApiIoUrl('/events/search', params.accessToken, {
        query: params.query,
        status: params.status,
      }),
    method: 'GET',
    headers: () => oddsApiIoHeaders(),
  },
  transformResponse: async (response) => {
    const data = await readOddsApiIoJson(response, 'search events')
    return { success: true, output: { events: toArray(data).map(mapEvent) } }
  },
  outputs: {
    events: {
      type: 'array',
      description: 'Matching events, most relevant first',
      items: { type: 'object', properties: EVENT_PROPERTIES },
    },
  },
}
