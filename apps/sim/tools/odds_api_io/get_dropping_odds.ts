import { toArray, toRecord } from '@sim/utils/object'
import type {
  OddsApiIoDroppingOdds,
  OddsApiIoGetDroppingOddsParams,
  OddsApiIoGetDroppingOddsResponse,
} from '@/tools/odds_api_io/types'
import {
  commaList,
  MARKET_PROPERTIES,
  mapMarket,
  NAMED_PROPERTIES,
  numberOrNull,
  oddsApiIoAuthParams,
  oddsApiIoHeaders,
  oddsApiIoOAuth,
  oddsApiIoUrl,
  readOddsApiIoJson,
  stringOrNull,
} from '@/tools/odds_api_io/utils'
import type { ToolConfig } from '@/tools/types'

function mapNamed(value: unknown) {
  if (value === undefined || value === null) return null
  const record = toRecord(value)
  return { name: stringOrNull(record.name), slug: stringOrNull(record.slug) }
}

function mapDroppingOdds(value: unknown): OddsApiIoDroppingOdds {
  const record = toRecord(value)
  const odds = toRecord(record.odds)
  const drop = toRecord(odds.drop)
  const event = record.event === undefined ? null : toRecord(record.event)
  return {
    eventId: numberOrNull(record.eventId),
    betSide: stringOrNull(record.betSide),
    market: mapMarket(record.market),
    odds: {
      opening: numberOrNull(odds.opening),
      current: numberOrNull(odds.current),
      drop: {
        sinceOpening: numberOrNull(drop.sinceOpening),
        '12h': numberOrNull(drop['12h']),
        '24h': numberOrNull(drop['24h']),
        '48h': numberOrNull(drop['48h']),
      },
    },
    lastMovedAt: numberOrNull(record.lastMovedAt),
    updatedAt: numberOrNull(record.updatedAt),
    event: event && {
      home: stringOrNull(event.home),
      away: stringOrNull(event.away),
      date: stringOrNull(event.date),
      sport: mapNamed(event.sport),
      league: mapNamed(event.league),
    },
  }
}

export const oddsApiIoGetDroppingOddsTool: ToolConfig<
  OddsApiIoGetDroppingOddsParams,
  OddsApiIoGetDroppingOddsResponse
> = {
  id: 'odds_api_io_get_dropping_odds',
  name: 'Odds-API.io Get Dropping Odds',
  description:
    'List selections whose odds have dropped the most since opening or over the last 12, 24 or 48 hours, filtered by sport, league and market.',
  version: '1.0.0',
  effect: 'read',
  oauth: oddsApiIoOAuth,
  params: {
    ...oddsApiIoAuthParams,
    sport: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sport slug (e.g. football, basketball)',
    },
    league: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'One league slug (e.g. england-premier-league); needs a sport, cannot be combined with leagues',
    },
    leagues: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated league slugs; cannot be combined with league',
    },
    markets: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated market names to include (e.g. ML,Spread,Totals)',
    },
    timeWindow: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Window the drop is measured over: opening (default), 12h, 24h or 48h',
    },
    minDrop: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum drop in percent for the selected window (default 0)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Results per page (default 50, max 200)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Page number, starting at 1',
    },
    includeEventDetails: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include the teams, date, sport and league of each event',
    },
  },
  request: {
    url: (params) =>
      oddsApiIoUrl('/dropping-odds', params.accessToken, {
        sport: params.sport,
        league: params.league,
        leagues: commaList(params.leagues),
        markets: commaList(params.markets),
        timeWindow: params.timeWindow,
        minDrop: params.minDrop,
        limit: params.limit,
        page: params.page,
        includeEventDetails: params.includeEventDetails ? 'true' : undefined,
      }),
    method: 'GET',
    headers: () => oddsApiIoHeaders(),
  },
  transformResponse: async (response) => {
    const data = await readOddsApiIoJson(response, 'get dropping odds')
    return { success: true, output: { droppingOdds: toArray(data).map(mapDroppingOdds) } }
  },
  outputs: {
    droppingOdds: {
      type: 'array',
      description: 'Selections sorted by drop in the selected window, largest first',
      items: {
        type: 'object',
        properties: {
          eventId: { type: 'number', description: 'Event ID', nullable: true },
          betSide: {
            type: 'string',
            description: 'Side whose odds dropped (home, draw, away, over, under)',
            nullable: true,
          },
          market: { type: 'object', description: 'Market', properties: MARKET_PROPERTIES },
          odds: {
            type: 'object',
            description: 'Opening and current odds with the drop per window',
            properties: {
              opening: { type: 'number', description: 'Opening odds', nullable: true },
              current: { type: 'number', description: 'Current odds', nullable: true },
              drop: {
                type: 'object',
                description: 'Drop in percent per window',
                properties: {
                  sinceOpening: { type: 'number', description: 'Since opening', nullable: true },
                  '12h': { type: 'number', description: 'Last 12 hours', nullable: true },
                  '24h': { type: 'number', description: 'Last 24 hours', nullable: true },
                  '48h': { type: 'number', description: 'Last 48 hours', nullable: true },
                },
              },
            },
          },
          lastMovedAt: {
            type: 'number',
            description: 'Unix milliseconds of the last odds movement',
            nullable: true,
          },
          updatedAt: {
            type: 'number',
            description: 'Unix milliseconds of the last recomputation',
            nullable: true,
          },
          event: {
            type: 'object',
            description: 'Event details, when requested',
            nullable: true,
            properties: {
              home: { type: 'string', description: 'Home team', nullable: true },
              away: { type: 'string', description: 'Away team', nullable: true },
              date: { type: 'string', description: 'Start time in ISO 8601', nullable: true },
              sport: {
                type: 'object',
                description: 'Sport',
                nullable: true,
                properties: NAMED_PROPERTIES,
              },
              league: {
                type: 'object',
                description: 'League',
                nullable: true,
                properties: NAMED_PROPERTIES,
              },
            },
          },
        },
      },
    },
  },
}
