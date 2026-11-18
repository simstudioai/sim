import { isPlainRecord } from '@sim/utils/object'
import type { PolymarketLeaderboardEntry } from '@/tools/polymarket/types'
import {
  appendDataPagination,
  buildDataUrl,
  handlePolymarketError,
  POLYMARKET_CURSOR_DESCRIPTION,
  POLYMARKET_DATA_PAGE_OUTPUTS,
  type PolymarketDataPage,
  readDataPage,
} from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

export interface PolymarketGetLeaderboardParams {
  category?: string
  timePeriod?: string
  orderBy?: string
  limit?: string
  offset?: string
  user?: string
  userName?: string
  cursor?: string
}

export interface PolymarketGetLeaderboardResponse {
  success: boolean
  output: PolymarketDataPage & {
    leaderboard: PolymarketLeaderboardEntry[]
  }
}

/** The volume board, named `VOL` in the retired Data API v1 and `VOLUME` in v2. */
function isVolumeBoard(orderBy: string | undefined): boolean {
  const board = orderBy?.toUpperCase()
  return board === 'VOL' || board === 'VOLUME'
}

function toLeaderboardEntry(
  entry: Record<string, unknown>,
  rank: unknown
): PolymarketLeaderboardEntry {
  return {
    rank: typeof rank === 'number' || typeof rank === 'string' ? String(rank) : '',
    proxyWallet: (entry.user_id as string) ?? '',
    userName: (entry.user_name as string) ?? null,
    vol: (entry.volume as number) ?? 0,
    pnl: (entry.pnl as number) ?? 0,
    profileImage: (entry.profile_image as string) ?? null,
    xUsername: (entry.x_username as string) ?? null,
    verifiedBadge: (entry.verified as boolean) ?? false,
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
      description: 'Order by: PNL or VOLUME (default: PNL)',
      visibility: 'user-or-llm',
    },
    limit: {
      type: 'string',
      required: false,
      description: 'Number of results for the first page (e.g., "10"). Max: 1000.',
      visibility: 'user-or-llm',
    },
    offset: {
      type: 'string',
      required: false,
      description:
        'Not supported by the Polymarket Data API v2, which pages by cursor. Use cursor instead.',
      visibility: 'user-or-llm',
    },
    user: {
      type: 'string',
      required: false,
      description: "Wallet address to look up that user's rank instead of the board",
      visibility: 'user-or-llm',
    },
    userName: {
      type: 'string',
      required: false,
      description:
        'Not supported by the Polymarket Data API v2. Use user with a wallet address instead.',
      visibility: 'user-or-llm',
    },
    cursor: {
      type: 'string',
      required: false,
      description: POLYMARKET_CURSOR_DESCRIPTION,
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params) => {
      if (params.userName?.trim()) {
        throw new Error(
          'Polymarket no longer looks up the leaderboard by username. Pass the wallet address as user.'
        )
      }
      const query = new URLSearchParams()
      if (params.category) query.append('category', params.category.toLowerCase())
      if (params.timePeriod) query.append('time_period', params.timePeriod.toLowerCase())
      if (params.orderBy) {
        query.append('sort_by', isVolumeBoard(params.orderBy) ? 'VOLUME' : params.orderBy)
      }
      if (params.user) query.append('user', params.user)
      appendDataPagination(query, params)
      return buildDataUrl('/leaderboard', query)
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params?: PolymarketGetLeaderboardParams) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_leaderboard')
    }

    if (isPlainRecord(data?.data)) {
      const standing = data.data
      const rank = isVolumeBoard(params?.orderBy) ? standing.rank_volume : standing.rank_pnl
      return {
        success: true,
        output: {
          leaderboard: [toLeaderboardEntry(standing, rank)],
          nextCursor: null,
          hasMore: false,
        },
      }
    }

    const { rows, page } = readDataPage(data)
    return {
      success: true,
      output: {
        leaderboard: rows.map((entry) => toLeaderboardEntry(entry, entry.rank)),
        ...page,
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
    ...POLYMARKET_DATA_PAGE_OUTPUTS,
  },
}
