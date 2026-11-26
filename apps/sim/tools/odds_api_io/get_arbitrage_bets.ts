import { isRecordLike, toArray, toRecord } from '@sim/utils/object'
import type {
  OddsApiIoArbitrage,
  OddsApiIoGetArbitrageBetsParams,
  OddsApiIoGetArbitrageBetsResponse,
} from '@/tools/odds_api_io/types'
import {
  commaList,
  MARKET_PROPERTIES,
  mapMarket,
  numberOrNull,
  oddsApiIoAuthParams,
  oddsApiIoHeaders,
  oddsApiIoOAuth,
  oddsApiIoUrl,
  readOddsApiIoJson,
  stringOrNull,
} from '@/tools/odds_api_io/utils'
import type { ToolConfig } from '@/tools/types'

function mapArbitrage(value: unknown): OddsApiIoArbitrage {
  const record = toRecord(value)
  return {
    id: stringOrNull(record.id),
    eventId: numberOrNull(record.eventId),
    market: mapMarket(record.market),
    profitMargin: numberOrNull(record.profitMargin),
    impliedProbability: numberOrNull(record.impliedProbability),
    totalStake: numberOrNull(record.totalStake),
    legs: toArray(record.legs).map((leg) => {
      const item = toRecord(leg)
      return {
        bookmaker: stringOrNull(item.bookmaker),
        side: stringOrNull(item.side),
        label: stringOrNull(item.label),
        odds: stringOrNull(item.odds),
        href: stringOrNull(item.href),
        directLink: stringOrNull(item.directLink),
        bookmakerFixtureId: stringOrNull(item.bookmakerFixtureId),
      }
    }),
    optimalStakes: toArray(record.optimalStakes).map((stake) => {
      const item = toRecord(stake)
      return {
        bookmaker: stringOrNull(item.bookmaker),
        side: stringOrNull(item.side),
        stake: numberOrNull(item.stake),
        potentialReturn: numberOrNull(item.potentialReturn),
      }
    }),
    updatedAt: stringOrNull(record.updatedAt),
    event: isRecordLike(record.event) ? record.event : null,
  }
}

export const oddsApiIoGetArbitrageBetsTool: ToolConfig<
  OddsApiIoGetArbitrageBetsParams,
  OddsApiIoGetArbitrageBetsResponse
> = {
  id: 'odds_api_io_get_arbitrage_bets',
  name: 'Odds-API.io Get Arbitrage Bets',
  description:
    'List current arbitrage opportunities across the given bookmakers, with the legs, margin and stake split of each. Only opportunities where every leg is at one of the listed bookmakers are returned.',
  version: '1.0.0',
  effect: 'read',
  oauth: oddsApiIoOAuth,
  params: {
    ...oddsApiIoAuthParams,
    bookmakers: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated bookmaker names (e.g. Bet365,Unibet)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of results (default 50, max 500)',
    },
    includeEventDetails: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include the event details of each opportunity',
    },
  },
  request: {
    url: (params) =>
      oddsApiIoUrl('/arbitrage-bets', params.accessToken, {
        bookmakers: commaList(params.bookmakers),
        limit: params.limit,
        includeEventDetails: params.includeEventDetails ? 'true' : undefined,
      }),
    method: 'GET',
    headers: () => oddsApiIoHeaders(),
  },
  transformResponse: async (response) => {
    const data = await readOddsApiIoJson(response, 'get arbitrage bets')
    return { success: true, output: { arbitrageBets: toArray(data).map(mapArbitrage) } }
  },
  outputs: {
    arbitrageBets: {
      type: 'array',
      description: 'Arbitrage opportunities across the bookmakers',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Opportunity ID', nullable: true },
          eventId: { type: 'number', description: 'Event ID', nullable: true },
          market: { type: 'object', description: 'Market', properties: MARKET_PROPERTIES },
          profitMargin: {
            type: 'number',
            description: 'Margin in percent when staking across all legs',
            nullable: true,
          },
          impliedProbability: {
            type: 'number',
            description: 'Sum of the implied probabilities of the legs (below 1 for an arbitrage)',
            nullable: true,
          },
          totalStake: {
            type: 'number',
            description: 'Total stake the optimal stakes are computed for',
            nullable: true,
          },
          legs: {
            type: 'array',
            description: 'One leg per outcome',
            items: {
              type: 'object',
              properties: {
                bookmaker: { type: 'string', description: 'Bookmaker', nullable: true },
                side: { type: 'string', description: 'Outcome (home, away, draw)', nullable: true },
                label: { type: 'string', description: 'Outcome label', nullable: true },
                odds: { type: 'string', description: 'Decimal odds', nullable: true },
                href: {
                  type: 'string',
                  description: 'Event page at the bookmaker',
                  nullable: true,
                },
                directLink: {
                  type: 'string',
                  description: 'Direct link to the selection',
                  nullable: true,
                },
                bookmakerFixtureId: {
                  type: 'string',
                  description: "The bookmaker's own event ID",
                  nullable: true,
                },
              },
            },
          },
          optimalStakes: {
            type: 'array',
            description: 'Stake split over the legs',
            items: {
              type: 'object',
              properties: {
                bookmaker: { type: 'string', description: 'Bookmaker', nullable: true },
                side: { type: 'string', description: 'Outcome', nullable: true },
                stake: { type: 'number', description: 'Stake on this leg', nullable: true },
                potentialReturn: {
                  type: 'number',
                  description: 'Return if this leg wins',
                  nullable: true,
                },
              },
            },
          },
          updatedAt: {
            type: 'string',
            description: 'When the opportunity was last updated',
            nullable: true,
          },
          event: { type: 'json', description: 'Event details, when requested', nullable: true },
        },
      },
    },
  },
}
