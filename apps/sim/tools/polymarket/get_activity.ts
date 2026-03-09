import type { PolymarketActivity } from '@/tools/polymarket/types'
import { buildDataUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

export interface PolymarketGetActivityParams {
  user: string
  limit?: string
  offset?: string
  market?: string
  eventId?: string
  type?: string
  start?: number
  end?: number
  sortBy?: string
  sortDirection?: string
  side?: string
}

export interface PolymarketGetActivityResponse {
  success: boolean
  output: {
    activity: PolymarketActivity[]
  }
}

export const polymarketGetActivityTool: ToolConfig<
  PolymarketGetActivityParams,
  PolymarketGetActivityResponse
> = {
  id: 'polymarket_get_activity',
  name: 'Get Activity from Polymarket',
  description:
    'Retrieve on-chain activity for a user including trades, splits, merges, redemptions, rewards, and conversions',
  version: '1.0.0',

  params: {
    user: {
      type: 'string',
      required: true,
      description: 'User wallet address (0x-prefixed)',
      visibility: 'user-or-llm',
    },
    limit: {
      type: 'string',
      required: false,
      description: 'Maximum results to return (e.g., "50"). Default: 100, max: 500.',
      visibility: 'user-or-llm',
    },
    offset: {
      type: 'string',
      required: false,
      description:
        'Number of results to skip for pagination (e.g., "100"). Default: 0, max: 10000.',
      visibility: 'user-or-llm',
    },
    market: {
      type: 'string',
      required: false,
      description:
        'Comma-separated condition IDs (e.g., "0x1234...abcd,0x5678...efgh"). Mutually exclusive with eventId.',
      visibility: 'user-or-llm',
    },
    eventId: {
      type: 'string',
      required: false,
      description:
        'Comma-separated event IDs (e.g., "12345,67890"). Mutually exclusive with market.',
      visibility: 'user-or-llm',
    },
    type: {
      type: 'string',
      required: false,
      description:
        'Activity type filter: TRADE, SPLIT, MERGE, REDEEM, REWARD, CONVERSION, MAKER_REBATE',
      visibility: 'user-or-llm',
    },
    start: {
      type: 'number',
      required: false,
      description: 'Start timestamp (Unix seconds)',
      visibility: 'user-or-llm',
    },
    end: {
      type: 'number',
      required: false,
      description: 'End timestamp (Unix seconds)',
      visibility: 'user-or-llm',
    },
    sortBy: {
      type: 'string',
      required: false,
      description: 'Sort field: TIMESTAMP, TOKENS, or CASH (default: TIMESTAMP)',
      visibility: 'user-or-llm',
    },
    sortDirection: {
      type: 'string',
      required: false,
      description: 'Sort direction: ASC or DESC (default: DESC)',
      visibility: 'user-or-llm',
    },
    side: {
      type: 'string',
      required: false,
      description: 'Trade side filter: BUY or SELL (only applies to trades)',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('user', params.user)
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.offset) queryParams.append('offset', params.offset)
      if (params.market) queryParams.append('market', params.market)
      if (params.eventId) queryParams.append('eventId', params.eventId)
      if (params.type) queryParams.append('type', params.type)
      if (params.start != null && !Number.isNaN(params.start))
        queryParams.append('start', String(params.start))
      if (params.end != null && !Number.isNaN(params.end))
        queryParams.append('end', String(params.end))
      if (params.sortBy) queryParams.append('sortBy', params.sortBy)
      if (params.sortDirection) queryParams.append('sortDirection', params.sortDirection)
      if (params.side) queryParams.append('side', params.side)
      return `${buildDataUrl('/activity')}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_activity')
    }

    const activityList = Array.isArray(data) ? data : []

    const activity: PolymarketActivity[] = activityList.map((a: any) => ({
      proxyWallet: a.proxyWallet ?? null,
      timestamp: a.timestamp ?? 0,
      conditionId: a.conditionId ?? '',
      type: a.type ?? '',
      size: a.size ?? 0,
      usdcSize: a.usdcSize ?? 0,
      transactionHash: a.transactionHash ?? null,
      price: a.price ?? null,
      asset: a.asset ?? null,
      side: a.side ?? null,
      outcomeIndex: a.outcomeIndex ?? null,
      title: a.title ?? null,
      slug: a.slug ?? null,
      icon: a.icon ?? null,
      eventSlug: a.eventSlug ?? null,
      outcome: a.outcome ?? null,
      name: a.name ?? null,
      pseudonym: a.pseudonym ?? null,
      bio: a.bio ?? null,
      profileImage: a.profileImage ?? null,
      profileImageOptimized: a.profileImageOptimized ?? null,
    }))

    return {
      success: true,
      output: {
        activity,
      },
    }
  },

  outputs: {
    activity: {
      type: 'array',
      description: 'Array of activity entries',
      items: {
        type: 'object',
        properties: {
          proxyWallet: { type: 'string', description: 'User proxy wallet address' },
          timestamp: { type: 'number', description: 'Unix timestamp of activity' },
          conditionId: { type: 'string', description: 'Market condition ID' },
          type: {
            type: 'string',
            description: 'Activity type (TRADE, SPLIT, MERGE, REDEEM, REWARD, CONVERSION)',
          },
          size: { type: 'number', description: 'Size in tokens' },
          usdcSize: { type: 'number', description: 'Size in USDC' },
          transactionHash: { type: 'string', description: 'Blockchain transaction hash' },
          price: { type: 'number', description: 'Price (for trades)' },
          asset: { type: 'string', description: 'Asset/token ID' },
          side: { type: 'string', description: 'Trade side (BUY/SELL)' },
          outcomeIndex: { type: 'number', description: 'Outcome index' },
          title: { type: 'string', description: 'Market title' },
          slug: { type: 'string', description: 'Market slug' },
          icon: { type: 'string', description: 'Market icon URL' },
          eventSlug: { type: 'string', description: 'Event slug' },
          outcome: { type: 'string', description: 'Outcome name' },
          name: { type: 'string', description: 'User display name' },
          pseudonym: { type: 'string', description: 'User pseudonym' },
          bio: { type: 'string', description: 'User bio' },
          profileImage: { type: 'string', description: 'User profile image URL' },
          profileImageOptimized: { type: 'string', description: 'Optimized profile image URL' },
        },
      },
    },
  },
}
