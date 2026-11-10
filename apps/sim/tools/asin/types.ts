import type { OutputProperty, ToolResponse } from '@/tools/types'

/** SearchResult read from a Asin API response. */
export interface AsinSearchResult {
  asin: string | null
  title: string | null
  image: string | null
  price: number | null
  currency: string | null
  rating: number | null
  reviewsCount: number | null
}

/** Offer read from a Asin API response. */
export interface AsinOffer {
  seller: string | null
  sellerId: string | null
  price: number | null
  amazon: boolean | null
  fulfilledByAmazon: boolean | null
  used: boolean | null
  deliveryTime: string | null
  deliveryPrice: string | null
}

/** PricePoint read from a Asin API response. */
export interface AsinPricePoint {
  price: number | null
  inStock: boolean | null
  coupon: string | null
  seller: string | null
  checkedAt: string | null
}

export const ASIN_SEARCH_RESULT_OUTPUT_PROPERTIES = {
  asin: {
    type: 'string',
    description: 'The ASIN of the product',
    optional: true,
  },
  title: {
    type: 'string',
    description: 'Product title',
    optional: true,
  },
  image: {
    type: 'string',
    description: 'URL of the main product image',
    optional: true,
  },
  price: {
    type: 'number',
    description: 'Price shown in the results',
    optional: true,
  },
  currency: {
    type: 'string',
    description: 'ISO 4217 code of the marketplace currency',
    optional: true,
  },
  rating: {
    type: 'number',
    description: 'Average rating out of 5',
    optional: true,
  },
  reviewsCount: {
    type: 'number',
    description: 'Number of reviews',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const ASIN_OFFER_OUTPUT_PROPERTIES = {
  seller: {
    type: 'string',
    description: 'Name of the seller',
    optional: true,
  },
  sellerId: {
    type: 'string',
    description: "Amazon's ID of the seller",
    optional: true,
  },
  price: {
    type: 'number',
    description: 'Price of the offer in the marketplace currency',
    optional: true,
  },
  amazon: {
    type: 'boolean',
    description: 'Whether Amazon itself sells the offer',
    optional: true,
  },
  fulfilledByAmazon: {
    type: 'boolean',
    description: 'Whether Amazon ships the offer',
    optional: true,
  },
  used: {
    type: 'boolean',
    description: 'Whether the offer is used or renewed',
    optional: true,
  },
  deliveryTime: {
    type: 'string',
    description: 'Delivery date, as Amazon shows it',
    optional: true,
  },
  deliveryPrice: {
    type: 'string',
    description: 'Delivery cost, as Amazon shows it',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const ASIN_PRICE_POINT_OUTPUT_PROPERTIES = {
  price: {
    type: 'number',
    description: 'Price of the offer shown; null when there was no offer',
    optional: true,
  },
  inStock: {
    type: 'boolean',
    description: 'Whether the product was in stock',
    optional: true,
  },
  coupon: {
    type: 'string',
    description: 'Coupon shown, if any',
    optional: true,
  },
  seller: {
    type: 'string',
    description: 'Seller of the offer shown (Buy Box)',
    optional: true,
  },
  checkedAt: {
    type: 'string',
    description: 'When Amazon was read',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface AsinSearchProductsParams {
  apiKey: string
  query: string
  marketplace?: string
}

export interface AsinSearchProductsResponse extends ToolResponse {
  output: {
    results: AsinSearchResult[]
  }
}

export interface AsinReadOffersParams {
  apiKey: string
  asin: string
  marketplace?: string
}

export interface AsinReadOffersResponse extends ToolResponse {
  output: {
    asin: string | null
    marketplace: string | null
    currency: string | null
    fetchedAt: string | null
    charged: boolean | null
    amazonPrice: number | null
    lowestNewPrice: number | null
    lowestUsedPrice: number | null
    offers: AsinOffer[]
  }
}

export interface AsinGetOffersParams {
  apiKey: string
  asin: string
  marketplace?: string
}

export interface AsinGetOffersResponse extends ToolResponse {
  output: {
    asin: string | null
    marketplace: string | null
    currency: string | null
    fetchedAt: string | null
    charged: boolean | null
    amazonPrice: number | null
    lowestNewPrice: number | null
    lowestUsedPrice: number | null
    offers: AsinOffer[]
  }
}

export interface AsinGetPriceHistoryParams {
  apiKey: string
  asin: string
  marketplace?: string
  days?: number
}

export interface AsinGetPriceHistoryResponse extends ToolResponse {
  output: {
    asin: string | null
    marketplace: string | null
    currency: string | null
    lowestPrice: number | null
    highestPrice: number | null
    averagePrice: number | null
    history: AsinPricePoint[]
  }
}
