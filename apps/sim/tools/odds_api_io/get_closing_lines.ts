import { toArray } from '@sim/utils/object'
import type {
  OddsApiIoGetClosingLinesParams,
  OddsApiIoGetClosingLinesResponse,
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

export const oddsApiIoGetClosingLinesTool: ToolConfig<
  OddsApiIoGetClosingLinesParams,
  OddsApiIoGetClosingLinesResponse
> = {
  id: 'odds_api_io_get_closing_lines',
  name: 'Odds-API.io Get Closing Lines',
  description:
    'Get the closing odds and final scores of every settled event in one or more leagues over a date range of up to 366 days, 100 events per page.',
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
    leagues: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated league slugs (max 10)',
    },
    from: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start date in RFC 3339 (e.g. 2026-08-01T00:00:00Z)',
    },
    to: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End date in RFC 3339, at most 366 days after the start',
    },
    markets: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated market names (e.g. ML,Spread,Totals)',
    },
    bookmakers: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated bookmaker names (max 30)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of events to return (capped at 100)',
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
      oddsApiIoUrl('/historical/closing-lines', params.accessToken, {
        sport: params.sport,
        leagues: commaList(params.leagues),
        from: params.from,
        to: params.to,
        markets: commaList(params.markets),
        bookmakers: commaList(params.bookmakers),
        limit: params.limit,
        skip: params.skip,
      }),
    method: 'GET',
    headers: () => oddsApiIoHeaders(),
  },
  transformResponse: async (response) => {
    const data = await readOddsApiIoJson(response, 'get closing lines')
    return { success: true, output: { events: toArray(data).map(mapEventOdds) } }
  },
  outputs: {
    events: {
      type: 'array',
      description: 'Settled events with their closing odds per bookmaker and final scores',
      items: { type: 'object', properties: EVENT_ODDS_PROPERTIES },
    },
  },
}
