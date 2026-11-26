import { toArray, toRecord } from '@sim/utils/object'
import type {
  OddsApiIoGetValueBetsParams,
  OddsApiIoGetValueBetsResponse,
  OddsApiIoValueBet,
} from '@/tools/odds_api_io/types'
import {
  numberOrNull,
  oddsApiIoAuthParams,
  oddsApiIoHeaders,
  oddsApiIoOAuth,
  oddsApiIoUrl,
  readOddsApiIoJson,
  stringOrNull,
} from '@/tools/odds_api_io/utils'
import type { ToolConfig } from '@/tools/types'

function mapValueBet(value: unknown): OddsApiIoValueBet {
  const record = toRecord(value)
  const market = record.market === undefined ? null : toRecord(record.market)
  const bookmakerOdds = record.bookmakerOdds === undefined ? null : toRecord(record.bookmakerOdds)
  const event = record.event === undefined ? null : toRecord(record.event)
  return {
    id: stringOrNull(record.id),
    eventId: numberOrNull(record.eventId),
    bookmaker: stringOrNull(record.bookmaker),
    betSide: stringOrNull(record.betSide),
    expectedValue: numberOrNull(record.expectedValue),
    expectedValueUpdatedAt: stringOrNull(record.expectedValueUpdatedAt),
    market: market && {
      name: stringOrNull(market.name),
      hdp: numberOrNull(market.hdp),
      home: stringOrNull(market.home),
      draw: stringOrNull(market.draw),
      away: stringOrNull(market.away),
      max: numberOrNull(market.max),
    },
    bookmakerOdds: bookmakerOdds && {
      home: stringOrNull(bookmakerOdds.home),
      draw: stringOrNull(bookmakerOdds.draw),
      away: stringOrNull(bookmakerOdds.away),
      hdp: stringOrNull(bookmakerOdds.hdp),
      href: stringOrNull(bookmakerOdds.href),
    },
    event: event && {
      home: stringOrNull(event.home),
      away: stringOrNull(event.away),
      date: stringOrNull(event.date),
      sport: stringOrNull(event.sport),
      league: stringOrNull(event.league),
    },
  }
}

export const oddsApiIoGetValueBetsTool: ToolConfig<
  OddsApiIoGetValueBetsParams,
  OddsApiIoGetValueBetsResponse
> = {
  id: 'odds_api_io_get_value_bets',
  name: 'Odds-API.io Get Value Bets',
  description:
    'List the current value bets for one bookmaker: selections whose price is above the market consensus, with the expected value of each. Refreshed every few seconds.',
  version: '1.0.0',
  effect: 'read',
  oauth: oddsApiIoOAuth,
  params: {
    ...oddsApiIoAuthParams,
    bookmaker: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Bookmaker name (e.g. Bet365)',
    },
    sport: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sport slug to filter by (e.g. baseball)',
    },
    league: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'League slug to filter by (e.g. usa-mlb); needs a sport as well',
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
      oddsApiIoUrl('/value-bets', params.accessToken, {
        bookmaker: params.bookmaker,
        sport: params.sport,
        league: params.league,
        includeEventDetails: params.includeEventDetails ? 'true' : undefined,
      }),
    method: 'GET',
    headers: () => oddsApiIoHeaders(),
  },
  transformResponse: async (response) => {
    const data = await readOddsApiIoJson(response, 'get value bets')
    return { success: true, output: { valueBets: toArray(data).map(mapValueBet) } }
  },
  outputs: {
    valueBets: {
      type: 'array',
      description: 'Value bets for the bookmaker',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Value bet ID', nullable: true },
          eventId: { type: 'number', description: 'Event ID', nullable: true },
          bookmaker: {
            type: 'string',
            description: 'Bookmaker offering the price',
            nullable: true,
          },
          betSide: {
            type: 'string',
            description: 'Side to back (home, draw, away, over, under)',
            nullable: true,
          },
          expectedValue: {
            type: 'number',
            description: 'Expected value of the selection as a fraction (0.05 = 5%)',
            nullable: true,
          },
          expectedValueUpdatedAt: {
            type: 'string',
            description: 'When the expected value was last computed',
            nullable: true,
          },
          market: {
            type: 'object',
            description: 'Market and consensus prices',
            nullable: true,
            properties: {
              name: { type: 'string', description: 'Market name', nullable: true },
              hdp: { type: 'number', description: 'Handicap or total line', nullable: true },
              home: { type: 'string', description: 'Consensus home price', nullable: true },
              draw: { type: 'string', description: 'Consensus draw price', nullable: true },
              away: { type: 'string', description: 'Consensus away price', nullable: true },
              max: { type: 'number', description: 'Stake limit, when published', nullable: true },
            },
          },
          bookmakerOdds: {
            type: 'object',
            description: "The bookmaker's own prices for the market",
            nullable: true,
            properties: {
              home: { type: 'string', description: 'Home price', nullable: true },
              draw: { type: 'string', description: 'Draw price', nullable: true },
              away: { type: 'string', description: 'Away price', nullable: true },
              hdp: { type: 'string', description: 'Handicap or total line', nullable: true },
              href: { type: 'string', description: 'Event page at the bookmaker', nullable: true },
            },
          },
          event: {
            type: 'object',
            description: 'Event details, when requested',
            nullable: true,
            properties: {
              home: { type: 'string', description: 'Home team', nullable: true },
              away: { type: 'string', description: 'Away team', nullable: true },
              date: { type: 'string', description: 'Start time', nullable: true },
              sport: { type: 'string', description: 'Sport', nullable: true },
              league: { type: 'string', description: 'League', nullable: true },
            },
          },
        },
      },
    },
  },
}
