import type {
  OddsApiIoGetEventOddsParams,
  OddsApiIoGetEventOddsResponse,
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

export const oddsApiIoGetEventOddsTool: ToolConfig<
  OddsApiIoGetEventOddsParams,
  OddsApiIoGetEventOddsResponse
> = {
  id: 'odds_api_io_get_event_odds',
  name: 'Odds-API.io Get Event Odds',
  description:
    'Get the current pre-match or live odds for one event from up to 30 bookmakers, every market included.',
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
    bookmakers: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated bookmaker names (max 30, e.g. Bet365,Unibet)',
    },
  },
  request: {
    url: (params) =>
      oddsApiIoUrl('/odds', params.accessToken, {
        eventId: params.eventId,
        bookmakers: commaList(params.bookmakers),
      }),
    method: 'GET',
    headers: () => oddsApiIoHeaders(),
  },
  transformResponse: async (response) => {
    const data = await readOddsApiIoJson(response, 'get event odds')
    return { success: true, output: { odds: mapEventOdds(data) } }
  },
  outputs: {
    odds: {
      type: 'object',
      description: 'The event with its odds per bookmaker',
      properties: EVENT_ODDS_PROPERTIES,
    },
  },
}
