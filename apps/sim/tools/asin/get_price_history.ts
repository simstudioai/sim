import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord, toRecordOrNull } from '@sim/utils/object'
import type {
  AsinGetPriceHistoryParams,
  AsinGetPriceHistoryResponse,
  AsinPricePoint,
} from '@/tools/asin/types'
import { ASIN_PRICE_POINT_OUTPUT_PROPERTIES } from '@/tools/asin/types'
import type { ToolConfig } from '@/tools/types'

/** Reads a `AsinPricePoint` from an untyped Asin API payload. */
function mapAsinPricePoint(value: unknown): AsinPricePoint | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    price: toNumberOrNull(record.price),
    inStock: toBooleanOrNull(record.in_stock),
    coupon: toStringOrNull(record.coupon),
    seller: toStringOrNull(record.seller),
    checkedAt: toStringOrNull(record.checked_at),
  }
}

export const asinGetPriceHistoryTool: ToolConfig<
  AsinGetPriceHistoryParams,
  AsinGetPriceHistoryResponse
> = {
  id: 'asin_get_price_history',
  name: 'Asin Get Price History',
  description:
    'Get every price read for an ASIN over a period, oldest first, with its lowest, highest and average price.',
  version: '1.0.0',

  params: {
    asin: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The 10-character ASIN of the product (e.g., "B09DFCB66S")',
    },
    marketplace: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Amazon store: com, co.uk, de, fr, it, es, ca, co.jp, com.br, com.mx or in (defaults to "com")',
    },
    days: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Days of history to return (defaults to 30)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Asin API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://www.asin.dev/api/v1/history`)
      url.searchParams.set('asin', params.asin.trim())
      if (params.marketplace?.trim()) url.searchParams.set('marketplace', params.marketplace.trim())
      if (params.days != null) url.searchParams.set('days', String(params.days))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        asin: toStringOrNull(data.asin),
        marketplace: toStringOrNull(data.marketplace),
        currency: toStringOrNull(data.currency),
        lowestPrice: toNumberOrNull(data.lowest_price),
        highestPrice: toNumberOrNull(data.highest_price),
        averagePrice: toNumberOrNull(data.average_price),
        history: toArray(data.history)
          .map(mapAsinPricePoint)
          .filter((item): item is AsinPricePoint => item !== null),
      },
    }
  },

  outputs: {
    asin: {
      type: 'string',
      description: 'The ASIN of the product',
      optional: true,
    },
    marketplace: {
      type: 'string',
      description: 'Amazon store the prices come from',
      optional: true,
    },
    currency: {
      type: 'string',
      description: 'ISO 4217 code of the marketplace currency',
      optional: true,
    },
    lowestPrice: {
      type: 'number',
      description: 'Lowest price of the period',
      optional: true,
    },
    highestPrice: {
      type: 'number',
      description: 'Highest price of the period',
      optional: true,
    },
    averagePrice: {
      type: 'number',
      description: 'Average price of the period',
      optional: true,
    },
    history: {
      type: 'array',
      description: 'Prices read over the period, oldest first',
      optional: true,
      items: { type: 'object', properties: ASIN_PRICE_POINT_OUTPUT_PROPERTIES },
    },
  },
}
