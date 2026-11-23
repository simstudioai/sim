import type { PolymarketPosition } from '@/tools/polymarket/types'
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

export interface PolymarketGetPositionsParams {
  user: string
  market?: string
  eventId?: string
  sizeThreshold?: string
  redeemable?: string | boolean
  mergeable?: string | boolean
  sortBy?: string
  sortDirection?: string
  title?: string
  limit?: string
  offset?: string
  cursor?: string
}

export interface PolymarketGetPositionsResponse {
  success: boolean
  output: PolymarketDataPage & {
    positions: PolymarketPosition[]
  }
}

/** Data API v1 sort names that v2 renamed; other values are sent as given. */
const V1_POSITION_SORTS: Record<string, string> = {
  CURRENT: 'CURRENT_VALUE',
  CASHPNL: 'UNREALIZED_PNL',
}

/** v2 selects redeemable or mergeable positions through `status` instead of boolean filters. */
function positionStatus(params: PolymarketGetPositionsParams): string | undefined {
  const redeemable = String(params.redeemable) === 'true'
  const mergeable = String(params.mergeable) === 'true'
  if (redeemable && mergeable) {
    throw new Error('Filter for redeemable or mergeable positions, not both.')
  }
  if (redeemable) return 'REDEEMABLE'
  if (mergeable) return 'MERGEABLE'
  return undefined
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
      description: 'Minimum current position size in shares (default: 0.1)',
      visibility: 'user-or-llm',
    },
    redeemable: {
      type: 'string',
      required: false,
      description:
        'true: only redeemable positions. false: drops redeemable positions from the returned page.',
      visibility: 'user-or-llm',
    },
    mergeable: {
      type: 'string',
      required: false,
      description:
        'true: only mergeable positions. false: drops mergeable positions from the returned page.',
      visibility: 'user-or-llm',
    },
    sortBy: {
      type: 'string',
      required: false,
      description:
        'Sort field: CURRENT_VALUE (default), TOKENS, PRICE, UNREALIZED_PNL, REALIZED_PNL, TOTAL_PNL, or TIMESTAMP',
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
      description: 'Number of results for the first page (e.g., "25"). Max: 1000.',
      visibility: 'user-or-llm',
    },
    offset: {
      type: 'string',
      required: false,
      description:
        'Not supported by the Polymarket Data API v2, which pages by cursor. Use cursor instead.',
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
      if (params.sizeThreshold) query.append('filter_amount', params.sizeThreshold)
      const status = positionStatus(params)
      if (status) query.append('status', status)
      if (params.sortBy) {
        const sortBy = params.sortBy.toUpperCase()
        query.append('sort_by', V1_POSITION_SORTS[sortBy] ?? sortBy)
      }
      if (params.sortDirection) query.append('sort_direction', params.sortDirection)
      if (params.title) query.append('title', params.title)
      appendDataPagination(query, params)
      return buildDataUrl('/positions', query)
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params?: PolymarketGetPositionsParams) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_positions')
    }

    const { rows, page } = readDataPage(data)
    const allPositions: PolymarketPosition[] = rows.map((p) => ({
      proxyWallet: (p.proxy_wallet as string) ?? null,
      asset: (p.token_id as string) ?? '',
      conditionId: (p.condition_id as string) ?? '',
      size: (p.current_size as number) ?? 0,
      avgPrice: (p.avg_price as number) ?? 0,
      initialValue: (p.entry_cost_usdc as number) ?? 0,
      currentValue: (p.current_value as number) ?? 0,
      cashPnl: (p.unrealized_pnl as number) ?? 0,
      percentPnl: (p.percent_pnl as number) ?? 0,
      totalBought: (p.total_size as number) ?? 0,
      realizedPnl: (p.realized_pnl as number) ?? 0,
      percentRealizedPnl: (p.percent_realized_pnl as number) ?? 0,
      curPrice: (p.current_price as number) ?? 0,
      redeemable: (p.redeemable as boolean) ?? false,
      mergeable: (p.mergeable as boolean) ?? false,
      title: (p.title as string) ?? null,
      slug: (p.slug as string) ?? null,
      icon: (p.icon as string) ?? null,
      eventSlug: (p.event_slug as string) ?? null,
      outcome: (p.outcome as string) ?? null,
      outcomeIndex: (p.outcome_index as number) ?? null,
      oppositeOutcome: (p.opposite_outcome as string) ?? null,
      oppositeAsset: (p.opposite_token_id as string) ?? null,
      endDate: (p.end_date as string) ?? null,
      negativeRisk: (p.negative_risk as boolean) ?? false,
      status: (p.status as string) ?? null,
    }))
    // v2 has no "not redeemable" or "not mergeable" status, so those filters apply to this page.
    const positions = allPositions.filter(
      (position) =>
        !(String(params?.redeemable) === 'false' && position.redeemable) &&
        !(String(params?.mergeable) === 'false' && position.mergeable)
    )

    return {
      success: true,
      output: {
        positions,
        ...page,
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
          status: {
            type: 'string',
            description: 'Position state (OPEN, REDEEMABLE, REDEEMABLE_LOST, MERGEABLE, CLOSED)',
            optional: true,
          },
        },
      },
    },
    ...POLYMARKET_DATA_PAGE_OUTPUTS,
  },
}
