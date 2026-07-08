import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  SPORTMONKS_PAGINATION_OUTPUT,
  type SportmonksBaseParams,
  type SportmonksPagination,
  type SportmonksPaginationParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_ODDS_BASE_URL,
  SPORTMONKS_PREMIUM_ODD_HISTORY_PROPERTIES,
  type SportmonksPremiumOddHistory,
} from '@/tools/sportmonks_odds/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetUpdatedHistoricalOddsBetweenParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  fromTimestamp: string
  toTimestamp: string
}

export interface SportmonksGetUpdatedHistoricalOddsBetweenResponse extends ToolResponse {
  output: {
    historicalOdds: SportmonksPremiumOddHistory[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksOddsGetUpdatedHistoricalOddsBetweenTool: ToolConfig<
  SportmonksGetUpdatedHistoricalOddsBetweenParams,
  SportmonksGetUpdatedHistoricalOddsBetweenResponse
> = {
  id: 'sportmonks_odds_get_updated_historical_odds_between',
  name: 'Get Updated Historical Odds Between Time Range',
  description:
    'Retrieve historical (premium) odds updated between two UNIX timestamps (max 5 minutes) from the Sportmonks Odds API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    fromTimestamp: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start of the range as a UNIX timestamp (e.g. 1767225600)',
    },
    toTimestamp: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End of the range as a UNIX timestamp (max 5 minutes after the start)',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. odd)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply (e.g. winningOdds)',
    },
    per_page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (max 50, default 25)',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number to retrieve',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order direction (asc or desc)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_ODDS_BASE_URL}/premium/history/updated/between/${encodeURIComponent(params.fromTimestamp.trim())}/${encodeURIComponent(params.toTimestamp.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_updated_historical_odds_between')
    }
    return {
      success: true,
      output: {
        historicalOdds: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    historicalOdds: {
      type: 'array',
      description: 'Array of historical premium odd value records updated within the time range',
      items: { type: 'object', properties: SPORTMONKS_PREMIUM_ODD_HISTORY_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
