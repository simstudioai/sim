import { isPlainRecord } from '@sim/utils/object'
import type { PolymarketMarketHolders } from '@/tools/polymarket/types'
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

export interface PolymarketGetHoldersParams {
  market: string
  limit?: string
  minBalance?: string
  cursor?: string
}

export interface PolymarketGetHoldersResponse {
  success: boolean
  output: PolymarketDataPage & {
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
      description: 'Number of holders per outcome token (e.g., "10"). Default: 100, max: 1000.',
      visibility: 'user-or-llm',
    },
    minBalance: {
      type: 'string',
      required: false,
      description: 'Minimum net balance in shares (default: 0)',
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
      query.append('condition', params.market)
      if (params.minBalance) query.append('min_balance', params.minBalance)
      appendDataPagination(query, params)
      return buildDataUrl('/holders', query)
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

    const { rows, page } = readDataPage(data)
    const holders: PolymarketMarketHolders[] = rows.map((group) => ({
      token: (group.token_id as string) ?? '',
      holders: (Array.isArray(group.holders) ? group.holders.filter(isPlainRecord) : []).map(
        (h) => ({
          proxyWallet: (h.proxy_wallet as string) ?? '',
          bio: (h.bio as string) ?? null,
          asset: (h.token_id as string) ?? '',
          pseudonym: (h.pseudonym as string) ?? null,
          amount: (h.amount as number) ?? 0,
          displayUsernamePublic: (h.display_username_public as boolean) ?? false,
          outcomeIndex: (h.outcome_index as number) ?? 0,
          name: (h.name as string) ?? null,
          profileImage: (h.profile_image as string) ?? null,
          profileImageOptimized: (h.profile_image_optimized as string) ?? null,
          verified: (h.verified as boolean) ?? false,
        })
      ),
    }))

    return {
      success: true,
      output: {
        holders,
        ...page,
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
                verified: { type: 'boolean', description: 'Whether the holder is verified' },
              },
            },
          },
        },
      },
    },
    ...POLYMARKET_DATA_PAGE_OUTPUTS,
  },
}
