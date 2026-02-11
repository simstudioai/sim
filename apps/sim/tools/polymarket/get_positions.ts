import type { PolymarketPosition } from '@/tools/polymarket/types'
import { buildDataUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

export interface PolymarketGetPositionsParams {
  user: string
  market?: string
  eventId?: string
  sizeThreshold?: string
  redeemable?: string
  mergeable?: string
  sortBy?: string
  sortDirection?: string
  title?: string
  limit?: string
  offset?: string
}

export interface PolymarketGetPositionsResponse {
  success: boolean
  output: {
    positions: PolymarketPosition[]
  }
}

export const polymarketGetPositionsTool: ToolConfig<
  PolymarketGetPositionsParams,
  PolymarketGetPositionsResponse
> = {
  id: 'polymarket_get_positions',
  name: 'Get Positions from Polymarket',
  description: 'Retrieve user positions from Polymarket',
  version: '1.0.0',

  params: {
    user: {
      type: 'string',
      required: true,
      description: 'User wallet address',
      visibility: 'user-or-llm',
    },
    market: {
      type: 'string',
      required: false,
      description:
        'Condition IDs to filter positions (e.g., "0x1234...abcd,0x5678...efgh"). Mutually exclusive with eventId.',
      visibility: 'user-or-llm',
    },
    eventId: {
      type: 'string',
      required: false,
      description: 'Event ID to filter positions (e.g., "12345"). Mutually exclusive with market.',
      visibility: 'user-or-llm',
    },
    sizeThreshold: {
      type: 'string',
      required: false,
      description: 'Minimum position size threshold (default: 1)',
      visibility: 'user-or-llm',
    },
    redeemable: {
      type: 'string',
      required: false,
      description: 'Filter for redeemable positions only (true/false)',
      visibility: 'user-or-llm',
    },
    mergeable: {
      type: 'string',
      required: false,
      description: 'Filter for mergeable positions only (true/false)',
      visibility: 'user-or-llm',
    },
    sortBy: {
      type: 'string',
      required: false,
      description:
        'Sort field (TOKENS, CURRENT, INITIAL, CASHPNL, PERCENTPNL, TITLE, RESOLVING, PRICE, AVGPRICE)',
      visibility: 'user-or-llm',
    },
    sortDirection: {
      type: 'string',
      required: false,
      description: 'Sort direction (ASC or DESC)',
      visibility: 'user-or-llm',
    },
    title: {
      type: 'string',
      required: false,
      description: 'Search filter by title',
      visibility: 'user-or-llm',
    },
    limit: {
      type: 'string',
      required: false,
      description: 'Number of results per page (e.g., "25").',
      visibility: 'user-or-llm',
    },
    offset: {
      type: 'string',
      required: false,
      description: 'Number of results to skip for pagination (e.g., "50").',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('user', params.user)
      if (params.market) queryParams.append('market', params.market)
      if (params.eventId) queryParams.append('eventId', params.eventId)
      if (params.sizeThreshold) queryParams.append('sizeThreshold', params.sizeThreshold)
      if (params.redeemable) queryParams.append('redeemable', params.redeemable)
      if (params.mergeable) queryParams.append('mergeable', params.mergeable)
      if (params.sortBy) queryParams.append('sortBy', params.sortBy)
      if (params.sortDirection) queryParams.append('sortDirection', params.sortDirection)
      if (params.title) queryParams.append('title', params.title)
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.offset) queryParams.append('offset', params.offset)

      return `${buildDataUrl('/positions')}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_positions')
    }

    const rawPositions = Array.isArray(data) ? data : []
    const positions: PolymarketPosition[] = rawPositions.map((p: Record<string, unknown>) => ({
      proxyWallet: (p.proxyWallet as string) ?? null,
      asset: (p.asset as string) ?? '',
      conditionId: (p.conditionId as string) ?? '',
      size: (p.size as number) ?? 0,
      avgPrice: (p.avgPrice as number) ?? 0,
      initialValue: (p.initialValue as number) ?? 0,
      currentValue: (p.currentValue as number) ?? 0,
      cashPnl: (p.cashPnl as number) ?? 0,
      percentPnl: (p.percentPnl as number) ?? 0,
      totalBought: (p.totalBought as number) ?? 0,
      realizedPnl: (p.realizedPnl as number) ?? 0,
      percentRealizedPnl: (p.percentRealizedPnl as number) ?? 0,
      curPrice: (p.curPrice as number) ?? 0,
      redeemable: (p.redeemable as boolean) ?? false,
      mergeable: (p.mergeable as boolean) ?? false,
      title: (p.title as string) ?? null,
      slug: (p.slug as string) ?? null,
      icon: (p.icon as string) ?? null,
      eventSlug: (p.eventSlug as string) ?? null,
      outcome: (p.outcome as string) ?? null,
      outcomeIndex: (p.outcomeIndex as number) ?? null,
      oppositeOutcome: (p.oppositeOutcome as string) ?? null,
      oppositeAsset: (p.oppositeAsset as string) ?? null,
      endDate: (p.endDate as string) ?? null,
      negativeRisk: (p.negativeRisk as boolean) ?? false,
    }))

    return {
      success: true,
      output: {
        positions,
      },
    }
  },

  outputs: {
    positions: {
      type: 'array',
      description: 'Array of position objects',
      items: {
        type: 'object',
        properties: {
          proxyWallet: { type: 'string', description: 'Proxy wallet address' },
          asset: { type: 'string', description: 'Asset token ID' },
          conditionId: { type: 'string', description: 'Condition ID' },
          size: { type: 'number', description: 'Position size' },
          avgPrice: { type: 'number', description: 'Average price' },
          initialValue: { type: 'number', description: 'Initial value' },
          currentValue: { type: 'number', description: 'Current value' },
          cashPnl: { type: 'number', description: 'Cash profit/loss' },
          percentPnl: { type: 'number', description: 'Percent profit/loss' },
          totalBought: { type: 'number', description: 'Total bought' },
          realizedPnl: { type: 'number', description: 'Realized profit/loss' },
          percentRealizedPnl: { type: 'number', description: 'Percent realized profit/loss' },
          curPrice: { type: 'number', description: 'Current price' },
          redeemable: { type: 'boolean', description: 'Whether position is redeemable' },
          mergeable: { type: 'boolean', description: 'Whether position is mergeable' },
          title: { type: 'string', description: 'Market title' },
          slug: { type: 'string', description: 'Market slug' },
          icon: { type: 'string', description: 'Market icon URL' },
          eventSlug: { type: 'string', description: 'Event slug' },
          outcome: { type: 'string', description: 'Outcome name' },
          outcomeIndex: { type: 'number', description: 'Outcome index' },
          oppositeOutcome: { type: 'string', description: 'Opposite outcome name' },
          oppositeAsset: { type: 'string', description: 'Opposite asset token ID' },
          endDate: { type: 'string', description: 'End date' },
          negativeRisk: { type: 'boolean', description: 'Whether negative risk' },
        },
      },
    },
  },
}
