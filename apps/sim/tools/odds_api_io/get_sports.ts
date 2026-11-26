import { toArray, toRecord } from '@sim/utils/object'
import type {
  OddsApiIoGetSportsParams,
  OddsApiIoGetSportsResponse,
} from '@/tools/odds_api_io/types'
import {
  NAMED_PROPERTIES,
  oddsApiIoAuthParams,
  oddsApiIoHeaders,
  oddsApiIoOAuth,
  oddsApiIoUrl,
  readOddsApiIoJson,
  stringOrNull,
} from '@/tools/odds_api_io/utils'
import type { ToolConfig } from '@/tools/types'

export const oddsApiIoGetSportsTool: ToolConfig<
  OddsApiIoGetSportsParams,
  OddsApiIoGetSportsResponse
> = {
  id: 'odds_api_io_get_sports',
  name: 'Odds-API.io Get Sports',
  description: 'List the sports Odds-API.io covers, with the slug each other operation filters by.',
  version: '1.0.0',
  effect: 'read',
  oauth: oddsApiIoOAuth,
  params: {
    ...oddsApiIoAuthParams,
  },
  request: {
    url: (params) => oddsApiIoUrl('/sports', params.accessToken),
    method: 'GET',
    headers: () => oddsApiIoHeaders(),
  },
  transformResponse: async (response) => {
    const data = await readOddsApiIoJson(response, 'get sports')
    return {
      success: true,
      output: {
        sports: toArray(data).map((sport) => {
          const record = toRecord(sport)
          return { name: stringOrNull(record.name), slug: stringOrNull(record.slug) }
        }),
      },
    }
  },
  outputs: {
    sports: {
      type: 'array',
      description: 'Sports with name and slug',
      items: { type: 'object', properties: NAMED_PROPERTIES },
    },
  },
}
