import type { PolymarketActivity } from '@/tools/polymarket/types'
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
  cursor?: string
}

export interface PolymarketGetActivityResponse {
  success: boolean
  output: PolymarketDataPage & {
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
      description: 'Number of results for the first page (e.g., "50"). Default: 100, max: 1000.',
      visibility: 'user-or-llm',
    },
    offset: {
      type: 'string',
      required: false,
      description:
        'Not supported by the Polymarket Data API v2, which pages by cursor. Use cursor instead.',
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
        'Activity type filter: TRADE, SPLIT, MERGE, REDEEM, REWARD, CONVERSION, MAKER_REBATE, REFERRAL_REWARD',
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
      description: 'Sort field. Polymarket supports only TIMESTAMP.',
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
    cursor: {
      type: 'string',
      required: false,
      description: POLYMARKET_CURSOR_DESCRIPTION,
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      query.append('user', params.user)
      if (params.market) query.append('condition', params.market)
      if (params.eventId) query.append('event_id', params.eventId)
      if (params.type) query.append('type', params.type)
      for (const key of ['start', 'end'] as const) {
        const value = params[key]
        if (value == null || String(value).trim() === '') continue
        const seconds = Number(value)
        if (!Number.isFinite(seconds)) {
          throw new Error(`${key} must be a Unix timestamp in seconds, got "${value}".`)
        }
        // v2 reads start=0 as "three years back"; 1 keeps the full history that 0 asked for.
        query.append(key, String(key === 'start' && seconds === 0 ? 1 : seconds))
      }
      if (params.sortBy) query.append('sort_by', params.sortBy)
      if (params.sortDirection) query.append('sort_direction', params.sortDirection)
      if (params.side) query.append('side', params.side)
      appendDataPagination(query, params)
      return buildDataUrl('/activity', query)
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

    const { rows, page } = readDataPage(data)
    const activity: PolymarketActivity[] = rows.map((a) => ({
      proxyWallet: (a.proxy_wallet as string) ?? null,
      timestamp: (a.timestamp as number) ?? 0,
      conditionId: (a.condition_id as string) ?? '',
      type: (a.type as string) ?? '',
      size: (a.size as number) ?? 0,
      usdcSize: (a.usdc_size as number) ?? 0,
      transactionHash: (a.transaction_hash as string) ?? null,
      price: (a.price as number) ?? null,
      asset: (a.token_id as string) ?? null,
      side: (a.side as string) ?? null,
      outcomeIndex: (a.outcome_index as number) ?? null,
      title: (a.title as string) ?? null,
      slug: (a.slug as string) ?? null,
      icon: (a.icon as string) ?? null,
      eventSlug: (a.event_slug as string) ?? null,
      outcome: (a.outcome as string) ?? null,
      name: (a.name as string) ?? null,
      pseudonym: (a.pseudonym as string) ?? null,
      bio: (a.bio as string) ?? null,
      profileImage: (a.profile_image as string) ?? null,
      profileImageOptimized: (a.profile_image_optimized as string) ?? null,
    }))

    return {
      success: true,
      output: {
        activity,
        ...page,
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
    ...POLYMARKET_DATA_PAGE_OUTPUTS,
  },
}
