import { toArray } from '@sim/utils/object'
import type {
  OddsApiIoGetMultiOddsParams,
  OddsApiIoGetMultiOddsResponse,
} from '@/tools/odds_api_io/types'
import {
  commaList,
  EVENT_ODDS_PROPERTIES,
  mapEventOdds,
  oddsApiIoAuthParams,
  oddsApiIoHeaders,
  oddsApiIoOAuth,
  oddsApiIoUrl,
  readOddsApiIoJson,
} from '@/tools/odds_api_io/utils'
import type { ToolConfig } from '@/tools/types'

export const oddsApiIoGetMultiOddsTool: ToolConfig<
  OddsApiIoGetMultiOddsParams,
  OddsApiIoGetMultiOddsResponse
> = {
  id: 'odds_api_io_get_multi_odds',
  name: 'Odds-API.io Get Multi Odds',
  description:
    'Get the current odds for up to 10 events in one request, from up to 30 bookmakers. Counts as a single request against the plan.',
  version: '1.0.0',
  effect: 'read',
  oauth: oddsApiIoOAuth,
  params: {
    ...oddsApiIoAuthParams,
    eventIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated event IDs (max 10)',
    },
    bookmakers: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated bookmaker names (max 30, e.g. Bet365,Unibet)',
    },
  },
  request: {
    url: (params) =>
      oddsApiIoUrl('/odds/multi', params.accessToken, {
        eventIds: commaList(params.eventIds),
        bookmakers: commaList(params.bookmakers),
      }),
    method: 'GET',
    headers: () => oddsApiIoHeaders(),
  },
  transformResponse: async (response) => {
    const data = await readOddsApiIoJson(response, 'get multi odds')
    return { success: true, output: { events: toArray(data).map(mapEventOdds) } }
  },
  outputs: {
    events: {
      type: 'array',
      description: 'Events with their odds per bookmaker',
      items: { type: 'object', properties: EVENT_ODDS_PROPERTIES },
    },
  },
}
