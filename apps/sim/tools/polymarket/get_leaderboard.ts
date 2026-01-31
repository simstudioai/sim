import type { PolymarketLeaderboardEntry } from '@/tools/polymarket/types'
import { buildDataUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

export interface PolymarketGetLeaderboardParams {
  category?: string
  timePeriod?: string
  orderBy?: string
  limit?: string
  offset?: string
  user?: string
  userName?: string
}

export interface PolymarketGetLeaderboardResponse {
  success: boolean
  output: {
    leaderboard: PolymarketLeaderboardEntry[]
  }
}

export const polymarketGetLeaderboardTool: ToolConfig<
  PolymarketGetLeaderboardParams,
  PolymarketGetLeaderboardResponse
> = {
  id: 'polymarket_get_leaderboard',
  name: 'Get Leaderboard from Polymarket',
  description: 'Retrieve trader leaderboard rankings by profit/loss or volume',
  version: '1.0.0',

  params: {
    category: {
      type: 'string',
      required: false,
      description:
        'Category filter: OVERALL, POLITICS, SPORTS, CRYPTO, CULTURE, MENTIONS, WEATHER, ECONOMICS, TECH, FINANCE (default: OVERALL)',
      visibility: 'user-or-llm',
    },
    timePeriod: {
      type: 'string',
      required: false,
      description: 'Time period: DAY, WEEK, MONTH, ALL (default: DAY)',
      visibility: 'user-or-llm',
    },
    orderBy: {
      type: 'string',
      required: false,
      description: 'Order by: PNL or VOL (default: PNL)',
      visibility: 'user-or-llm',
    },
    limit: {
      type: 'string',
      required: false,
      description: 'Number of results to return (e.g., "10"). Range: 1-50, default: 25.',
      visibility: 'user-or-llm',
    },
    offset: {
      type: 'string',
      required: false,
      description:
        'Number of results to skip for pagination (e.g., "25"). Range: 0-1000, default: 0.',
      visibility: 'user-or-llm',
    },
    user: {
      type: 'string',
      required: false,
      description: 'Filter by specific user wallet address',
      visibility: 'user-or-llm',
    },
    userName: {
      type: 'string',
      required: false,
      description: 'Filter by username',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.category) queryParams.append('category', params.category)
      if (params.timePeriod) queryParams.append('timePeriod', params.timePeriod)
      if (params.orderBy) queryParams.append('orderBy', params.orderBy)
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.offset) queryParams.append('offset', params.offset)
      if (params.user) queryParams.append('user', params.user)
      if (params.userName) queryParams.append('userName', params.userName)
      const query = queryParams.toString()
      return query ? `${buildDataUrl('/v1/leaderboard')}?${query}` : buildDataUrl('/v1/leaderboard')
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_leaderboard')
    }

    const entries = Array.isArray(data) ? data : []

    const leaderboard: PolymarketLeaderboardEntry[] = entries.map((entry: any) => ({
      rank: entry.rank ?? '',
      proxyWallet: entry.proxyWallet ?? '',
      userName: entry.userName ?? null,
      vol: entry.vol ?? 0,
      pnl: entry.pnl ?? 0,
      profileImage: entry.profileImage ?? null,
      xUsername: entry.xUsername ?? null,
      verifiedBadge: entry.verifiedBadge ?? false,
    }))

    return {
      success: true,
      output: {
        leaderboard,
      },
    }
  },

  outputs: {
    leaderboard: {
      type: 'array',
      description: 'Array of leaderboard entries',
      items: {
        type: 'object',
        properties: {
          rank: { type: 'string', description: 'Leaderboard rank position' },
          proxyWallet: { type: 'string', description: 'User proxy wallet address' },
          userName: { type: 'string', description: 'User display name' },
          vol: { type: 'number', description: 'Trading volume' },
          pnl: { type: 'number', description: 'Profit and loss' },
          profileImage: { type: 'string', description: 'User profile image URL' },
          xUsername: { type: 'string', description: 'Twitter/X username' },
          verifiedBadge: { type: 'boolean', description: 'Whether user has verified badge' },
        },
      },
    },
  },
}
