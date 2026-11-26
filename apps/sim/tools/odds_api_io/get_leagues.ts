import { toArray, toRecord } from '@sim/utils/object'
import type {
  OddsApiIoGetLeaguesParams,
  OddsApiIoGetLeaguesResponse,
} from '@/tools/odds_api_io/types'
import {
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

export const oddsApiIoGetLeaguesTool: ToolConfig<
  OddsApiIoGetLeaguesParams,
  OddsApiIoGetLeaguesResponse
> = {
  id: 'odds_api_io_get_leagues',
  name: 'Odds-API.io Get Leagues',
  description:
    'List the leagues of a sport with their slug and the number of events that currently have odds.',
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
    all: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include leagues that have no active events',
    },
  },
  request: {
    url: (params) =>
      oddsApiIoUrl('/leagues', params.accessToken, {
        sport: params.sport,
        all: params.all ? 'true' : undefined,
      }),
    method: 'GET',
    headers: () => oddsApiIoHeaders(),
  },
  transformResponse: async (response) => {
    const data = await readOddsApiIoJson(response, 'get leagues')
    return {
      success: true,
      output: {
        leagues: toArray(data).map((league) => {
          const record = toRecord(league)
          return {
            name: stringOrNull(record.name),
            slug: stringOrNull(record.slug),
            eventsCount: numberOrNull(record.eventsCount),
          }
        }),
      },
    }
  },
  outputs: {
    leagues: {
      type: 'array',
      description: 'Leagues of the sport',
      items: {
        type: 'object',
        properties: {
          ...NAMED_PROPERTIES,
          eventsCount: {
            type: 'number',
            description: 'Number of events with odds in the league',
            nullable: true,
          },
        },
      },
    },
  },
}
