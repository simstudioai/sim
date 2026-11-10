import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import type {
  PiloterrEbayGetListingParams,
  PiloterrEbayGetListingResponse,
  PiloterrEbaySpecification,
} from '@/tools/piloterr/types'
import {
  PILOTERR_EBAY_SELLER_OUTPUT_PROPERTIES,
  PILOTERR_EBAY_SPECIFICATION_OUTPUT_PROPERTIES,
} from '@/tools/piloterr/types'
import { mapPiloterrEbaySeller, mapPiloterrEbaySpecification } from '@/tools/piloterr/utils'
import type { ToolConfig } from '@/tools/types'

export const piloterrEbayGetListingTool: ToolConfig<
  PiloterrEbayGetListingParams,
  PiloterrEbayGetListingResponse
> = {
  id: 'piloterr_ebay_get_listing',
  name: 'Piloterr Get eBay Listing',
  description:
    'Get an eBay listing by item ID or URL, with its price, condition, availability, seller, shipping and item specifics.',
  version: '1.0.0',

  params: {
    item: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'eBay item ID or listing URL (e.g., "257758922911")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Piloterr API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.piloterr.com/v2/ebay/product`)
      url.searchParams.set('query', params.item.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'x-api-key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        itemId: toStringOrNull(data.item_id),
        title: toStringOrNull(data.title),
        url: toStringOrNull(data.url),
        price: toNumberOrNull(data.price),
        currency: toStringOrNull(data.currency),
        priceDisplay: toStringOrNull(data.price_display),
        condition: toStringOrNull(data.condition),
        conditionDescription: toStringOrNull(data.condition_description),
        availability: toStringOrNull(data.availability),
        isBuyItNow: toBooleanOrNull(data.is_buy_it_now),
        isBestOffer: toBooleanOrNull(data.is_best_offer),
        watchers: toNumberOrNull(data.watchers),
        imageUrl: toStringOrNull(data.image_url),
        seller: mapPiloterrEbaySeller(data.seller),
        shipping: toStringOrNull(toRecord(data.shipping).summary),
        returns: toStringOrNull(toRecord(data.returns).summary),
        specifications: toArray(data.specifications)
          .map(mapPiloterrEbaySpecification)
          .filter((item): item is PiloterrEbaySpecification => item !== null),
        paymentMethods: toArray(data.payment_methods).filter(
          (item): item is string => typeof item === 'string'
        ),
      },
    }
  },

  outputs: {
    itemId: {
      type: 'string',
      description: 'eBay item ID',
      optional: true,
    },
    title: {
      type: 'string',
      description: 'Title of the listing',
      optional: true,
    },
    url: {
      type: 'string',
      description: 'URL of the listing',
      optional: true,
    },
    price: {
      type: 'number',
      description: 'Price of the listing',
      optional: true,
    },
    currency: {
      type: 'string',
      description: 'ISO 4217 code of the price',
      optional: true,
    },
    priceDisplay: {
      type: 'string',
      description: 'Price as eBay displays it',
      optional: true,
    },
    condition: {
      type: 'string',
      description: 'Condition of the item, such as New or Used',
      optional: true,
    },
    conditionDescription: {
      type: 'string',
      description: "Seller's description of the condition",
      optional: true,
    },
    availability: {
      type: 'string',
      description: 'Availability, such as InStock or OutOfStock',
      optional: true,
    },
    isBuyItNow: {
      type: 'boolean',
      description: 'Whether the listing can be bought now',
      optional: true,
    },
    isBestOffer: {
      type: 'boolean',
      description: 'Whether the seller accepts best offers',
      optional: true,
    },
    watchers: {
      type: 'number',
      description: 'Number of people watching the listing',
      optional: true,
    },
    imageUrl: {
      type: 'string',
      description: 'URL of the main image',
      optional: true,
    },
    seller: {
      type: 'object',
      description: 'Seller of the listing',
      optional: true,
      properties: PILOTERR_EBAY_SELLER_OUTPUT_PROPERTIES,
    },
    shipping: {
      type: 'string',
      description: 'Shipping summary',
      optional: true,
    },
    returns: {
      type: 'string',
      description: 'Returns policy summary',
      optional: true,
    },
    specifications: {
      type: 'array',
      description: 'Item specifics',
      optional: true,
      items: { type: 'object', properties: PILOTERR_EBAY_SPECIFICATION_OUTPUT_PROPERTIES },
    },
    paymentMethods: {
      type: 'array',
      description: 'Accepted payment methods',
      optional: true,
      items: { type: 'string' },
    },
  },
}
