import { toArray, toRecord } from '@sim/utils/object'
import type {
  OddsApiIoGetBookmakersParams,
  OddsApiIoGetBookmakersResponse,
} from '@/tools/odds_api_io/types'
import {
  oddsApiIoAuthParams,
  oddsApiIoHeaders,
  oddsApiIoOAuth,
  oddsApiIoUrl,
  readOddsApiIoJson,
  stringOrNull,
} from '@/tools/odds_api_io/utils'
import type { ToolConfig } from '@/tools/types'

export const oddsApiIoGetBookmakersTool: ToolConfig<
  OddsApiIoGetBookmakersParams,
  OddsApiIoGetBookmakersResponse
> = {
  id: 'odds_api_io_get_bookmakers',
  name: 'Odds-API.io Get Bookmakers',
  description:
    'List every bookmaker Odds-API.io supports, with the exact name to pass to the odds operations.',
  version: '1.0.0',
  effect: 'read',
  oauth: oddsApiIoOAuth,
  params: {
    ...oddsApiIoAuthParams,
  },
  request: {
    url: (params) => oddsApiIoUrl('/bookmakers', params.accessToken),
    method: 'GET',
    headers: () => oddsApiIoHeaders(),
  },
  transformResponse: async (response) => {
    const data = await readOddsApiIoJson(response, 'get bookmakers')
    return {
      success: true,
      output: {
        bookmakers: toArray(data).map((bookmaker) => {
          const record = toRecord(bookmaker)
          return {
            name: stringOrNull(record.name),
            active: typeof record.active === 'boolean' ? record.active : null,
          }
        }),
      },
    }
  },
  outputs: {
    bookmakers: {
      type: 'array',
      description: 'Supported bookmakers',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Bookmaker name as used in filters',
            nullable: true,
          },
          active: {
            type: 'boolean',
            description: 'Whether the bookmaker is currently active',
            nullable: true,
          },
        },
      },
    },
  },
}
