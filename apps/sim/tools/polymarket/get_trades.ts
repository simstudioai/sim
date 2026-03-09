import type { PolymarketTrade } from '@/tools/polymarket/types'
import { buildDataUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

export interface PolymarketGetTradesParams {
  user?: string
  market?: string
  eventId?: string
  side?: string
  takerOnly?: string
  filterType?: string
  filterAmount?: string
  limit?: string
  offset?: string
}

export interface PolymarketGetTradesResponse {
  success: boolean
  output: {
    trades: PolymarketTrade[]
  }
}

export const polymarketGetTradesTool: ToolConfig<
  PolymarketGetTradesParams,
  PolymarketGetTradesResponse
> = {
  id: 'polymarket_get_trades',
  name: 'Get Trades from Polymarket',
  description: 'Retrieve trade history from Polymarket',
  version: '1.0.0',

  params: {
    user: {
      type: 'string',
      required: false,
      description: 'User wallet address to filter trades',
      visibility: 'user-or-llm',
    },
    market: {
      type: 'string',
      required: false,
      description:
        'Market/condition ID to filter trades (e.g., "0x1234...abcd"). Mutually exclusive with eventId.',
      visibility: 'user-or-llm',
    },
    eventId: {
      type: 'string',
      required: false,
      description: 'Event ID to filter trades (e.g., "12345"). Mutually exclusive with market.',
      visibility: 'user-or-llm',
    },
    side: {
      type: 'string',
      required: false,
      description: 'Trade direction filter (BUY or SELL)',
      visibility: 'user-or-llm',
    },
    takerOnly: {
      type: 'string',
      required: false,
      description: 'Filter for taker trades only (true/false, default: true)',
      visibility: 'user-or-llm',
    },
    filterType: {
      type: 'string',
      required: false,
      description: 'Filter type (CASH or TOKENS) - requires filterAmount',
      visibility: 'user-or-llm',
    },
    filterAmount: {
      type: 'string',
      required: false,
      description: 'Filter amount threshold - requires filterType',
      visibility: 'user-or-llm',
    },
    limit: {
      type: 'string',
      required: false,
      description: 'Number of results per page (e.g., "50"). Default: 100, max: 10000.',
      visibility: 'user-or-llm',
    },
    offset: {
      type: 'string',
      required: false,
      description: 'Number of results to skip for pagination (e.g., "100").',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.user) queryParams.append('user', params.user)
      if (params.market) queryParams.append('market', params.market)
      if (params.eventId) queryParams.append('eventId', params.eventId)
      if (params.side) queryParams.append('side', params.side.toUpperCase())
      if (params.takerOnly) queryParams.append('takerOnly', params.takerOnly)
      if (params.filterType) queryParams.append('filterType', params.filterType.toUpperCase())
      if (params.filterAmount) queryParams.append('filterAmount', params.filterAmount)
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.offset) queryParams.append('offset', params.offset)

      const url = buildDataUrl('/trades')
      return `${url}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_trades')
    }

    const rawTrades = Array.isArray(data) ? data : []
    const trades: PolymarketTrade[] = rawTrades.map((t: Record<string, unknown>) => ({
      proxyWallet: (t.proxyWallet as string) ?? null,
      side: (t.side as string) ?? '',
      asset: (t.asset as string) ?? '',
      conditionId: (t.conditionId as string) ?? '',
      size: (t.size as number) ?? 0,
      price: (t.price as number) ?? 0,
      timestamp: (t.timestamp as number) ?? 0,
      title: (t.title as string) ?? null,
      slug: (t.slug as string) ?? null,
      icon: (t.icon as string) ?? null,
      eventSlug: (t.eventSlug as string) ?? null,
      outcome: (t.outcome as string) ?? null,
      outcomeIndex: (t.outcomeIndex as number) ?? null,
      name: (t.name as string) ?? null,
      pseudonym: (t.pseudonym as string) ?? null,
      bio: (t.bio as string) ?? null,
      profileImage: (t.profileImage as string) ?? null,
      profileImageOptimized: (t.profileImageOptimized as string) ?? null,
      transactionHash: (t.transactionHash as string) ?? null,
    }))

    return {
      success: true,
      output: {
        trades,
      },
    }
  },

  outputs: {
    trades: {
      type: 'array',
      description: 'Array of trade objects',
      items: {
        type: 'object',
        properties: {
          proxyWallet: { type: 'string', description: 'Proxy wallet address' },
          side: { type: 'string', description: 'Trade side (BUY or SELL)' },
          asset: { type: 'string', description: 'Asset token ID' },
          conditionId: { type: 'string', description: 'Condition ID' },
          size: { type: 'number', description: 'Trade size' },
          price: { type: 'number', description: 'Trade price' },
          timestamp: { type: 'number', description: 'Unix timestamp' },
          title: { type: 'string', description: 'Market title' },
          slug: { type: 'string', description: 'Market slug' },
          icon: { type: 'string', description: 'Market icon URL' },
          eventSlug: { type: 'string', description: 'Event slug' },
          outcome: { type: 'string', description: 'Outcome name' },
          outcomeIndex: { type: 'number', description: 'Outcome index' },
          name: { type: 'string', description: 'Trader name' },
          pseudonym: { type: 'string', description: 'Trader pseudonym' },
          bio: { type: 'string', description: 'Trader bio' },
          profileImage: { type: 'string', description: 'Profile image URL' },
          profileImageOptimized: { type: 'string', description: 'Optimized profile image URL' },
          transactionHash: { type: 'string', description: 'Transaction hash' },
        },
      },
    },
  },
}
