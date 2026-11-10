import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import type { AsinOffer, AsinReadOffersParams, AsinReadOffersResponse } from '@/tools/asin/types'
import { ASIN_OFFER_OUTPUT_PROPERTIES } from '@/tools/asin/types'
import { mapAsinOffer } from '@/tools/asin/utils'
import type { ToolConfig } from '@/tools/types'

export const asinReadOffersTool: ToolConfig<AsinReadOffersParams, AsinReadOffersResponse> = {
  id: 'asin_read_offers',
  name: 'Asin Read Offers',
  description:
    "Read every offer for an ASIN from Amazon now (uses a credit): seller, price, Prime and FBA, delivery, with Amazon's own price and the lowest new and used offers.",
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
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Asin API key',
    },
  },

  request: {
    url: 'https://www.asin.dev/api/v1/offers',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      asin: params.asin.trim(),
      ...(params.marketplace != null ? { marketplace: params.marketplace } : {}),
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
        fetchedAt: toStringOrNull(data.fetched_at),
        charged: toBooleanOrNull(data.charged),
        amazonPrice: toNumberOrNull(data.amazon_price),
        lowestNewPrice: toNumberOrNull(data.lowest_new_price),
        lowestUsedPrice: toNumberOrNull(data.lowest_used_price),
        offers: toArray(data.offers)
          .map(mapAsinOffer)
          .filter((item): item is AsinOffer => item !== null),
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
      description: 'Amazon store the offers come from',
      optional: true,
    },
    currency: {
      type: 'string',
      description: 'ISO 4217 code of the marketplace currency',
      optional: true,
    },
    fetchedAt: {
      type: 'string',
      description: 'When Amazon was read; null when the product was never read',
      optional: true,
    },
    charged: {
      type: 'boolean',
      description: 'Whether the request used a credit',
      optional: true,
    },
    amazonPrice: {
      type: 'number',
      description: "Amazon's own price, when Amazon sells the product",
      optional: true,
    },
    lowestNewPrice: {
      type: 'number',
      description: 'Lowest price among offers that are not used',
      optional: true,
    },
    lowestUsedPrice: {
      type: 'number',
      description: 'Lowest used or renewed price',
      optional: true,
    },
    offers: {
      type: 'array',
      description: 'Offers for the product, cheapest first',
      optional: true,
      items: { type: 'object', properties: ASIN_OFFER_OUTPUT_PROPERTIES },
    },
  },
}
