import type { PolymarketMarketHolders } from '@/tools/polymarket/types'
import { buildDataUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

export interface PolymarketGetHoldersParams {
  market: string
  limit?: string
  minBalance?: string
}

export interface PolymarketGetHoldersResponse {
  success: boolean
  output: {
    holders: PolymarketMarketHolders[]
  }
}

export const polymarketGetHoldersTool: ToolConfig<
  PolymarketGetHoldersParams,
  PolymarketGetHoldersResponse
> = {
  id: 'polymarket_get_holders',
  name: 'Get Market Holders from Polymarket',
  description: 'Retrieve top holders of a specific market token',
  version: '1.0.0',

  params: {
    market: {
      type: 'string',
      required: true,
      description:
        'Comma-separated list of condition IDs (e.g., "0x1234...abcd" or "0x1234...abcd,0x5678...efgh").',
      visibility: 'user-or-llm',
    },
    limit: {
      type: 'string',
      required: false,
      description: 'Number of holders to return (e.g., "10"). Range: 0-20, default: 20.',
      visibility: 'user-or-llm',
    },
    minBalance: {
      type: 'string',
      required: false,
      description: 'Minimum balance threshold (default: 1)',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('market', params.market)
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.minBalance) queryParams.append('minBalance', params.minBalance)
      return `${buildDataUrl('/holders')}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_holders')
    }

    const marketHolders = Array.isArray(data) ? data : []

    const holders: PolymarketMarketHolders[] = marketHolders.map((mh: any) => ({
      token: mh.token ?? '',
      holders: (mh.holders ?? []).map((h: any) => ({
        proxyWallet: h.proxyWallet ?? '',
        bio: h.bio ?? null,
        asset: h.asset ?? '',
        pseudonym: h.pseudonym ?? null,
        amount: h.amount ?? 0,
        displayUsernamePublic: h.displayUsernamePublic ?? false,
        outcomeIndex: h.outcomeIndex ?? 0,
        name: h.name ?? null,
        profileImage: h.profileImage ?? null,
        profileImageOptimized: h.profileImageOptimized ?? null,
      })),
    }))

    return {
      success: true,
      output: {
        holders,
      },
    }
  },

  outputs: {
    holders: {
      type: 'array',
      description: 'Array of market holder groups by token',
      items: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Token/asset ID' },
          holders: {
            type: 'array',
            description: 'Array of holders for this token',
            items: {
              type: 'object',
              properties: {
                proxyWallet: { type: 'string', description: 'Holder wallet address' },
                bio: { type: 'string', description: 'Holder bio' },
                asset: { type: 'string', description: 'Asset ID' },
                pseudonym: { type: 'string', description: 'Holder pseudonym' },
                amount: { type: 'number', description: 'Amount held' },
                displayUsernamePublic: {
                  type: 'boolean',
                  description: 'Whether username is publicly displayed',
                },
                outcomeIndex: { type: 'number', description: 'Outcome index' },
                name: { type: 'string', description: 'Holder display name' },
                profileImage: { type: 'string', description: 'Profile image URL' },
                profileImageOptimized: {
                  type: 'string',
                  description: 'Optimized profile image URL',
                },
              },
            },
          },
        },
      },
    },
  },
}
