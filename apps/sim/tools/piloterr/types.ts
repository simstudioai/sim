import type { OutputProperty, ToolFileData, ToolResponse } from '@/tools/types'

/** TechnologyCategory read from a Piloterr API response. */
export interface PiloterrTechnologyCategory {
  name: string | null
  slug: string | null
}

/** Technology read from a Piloterr API response. */
export interface PiloterrTechnology {
  name: string | null
  slug: string | null
  version: string | null
  website: string | null
  description: string | null
  confidence: number | null
  categories: PiloterrTechnologyCategory[]
}

/** SearchResult read from a Piloterr API response. */
export interface PiloterrSearchResult {
  position: number | null
  title: string | null
  link: string | null
  domain: string | null
  displayedLink: string | null
  source: string | null
  snippet: string | null
}

/** AmazonProduct read from a Piloterr API response. */
export interface PiloterrAmazonProduct {
  asin: string | null
  title: string | null
  url: string | null
  price: number | null
  realPrice: number | null
  rating: number | null
  reviewsCount: number | null
}

/** EbaySeller read from a Piloterr API response. */
export interface PiloterrEbaySeller {
  name: string | null
  feedback: string | null
  positiveFeedbackPercent: number | null
}

/** EbaySpecification read from a Piloterr API response. */
export interface PiloterrEbaySpecification {
  name: string | null
  value: string | null
}

/** EbayListing read from a Piloterr API response. */
export interface PiloterrEbayListing {
  position: number | null
  itemId: string | null
  title: string | null
  subtitle: string | null
  url: string | null
  price: number | null
  currency: string | null
  priceDisplay: string | null
  condition: string | null
  buyingFormat: string | null
  shipping: string | null
  imageUrl: string | null
  seller: PiloterrEbaySeller | null
}

/** LinkedinHeadquarter read from a Piloterr API response. */
export interface PiloterrLinkedinHeadquarter {
  line1: string | null
  city: string | null
  postalCode: string | null
  country: string | null
}

/** LinkedinCompanyLink read from a Piloterr API response. */
export interface PiloterrLinkedinCompanyLink {
  companyName: string | null
  companyUrl: string | null
}

/** CrunchbaseCategory read from a Piloterr API response. */
export interface PiloterrCrunchbaseCategory {
  name: string | null
  permalink: string | null
}

/** CrunchbaseLocation read from a Piloterr API response. */
export interface PiloterrCrunchbaseLocation {
  name: string | null
  type: string | null
}

/** CrunchbaseInvestor read from a Piloterr API response. */
export interface PiloterrCrunchbaseInvestor {
  name: string | null
  permalink: string | null
  fundingRound: string | null
}

/** CrunchbaseProduct read from a Piloterr API response. */
export interface PiloterrCrunchbaseProduct {
  name: string | null
  description: string | null
}

/** ZillowPhoto read from a Piloterr API response. */
export interface PiloterrZillowPhoto {
  url: string | null
  width: number | null
}

const PILOTERR_TECHNOLOGY_CATEGORY_OUTPUT_PROPERTIES = {
  name: {
    type: 'string',
    description: 'Name of the category, such as CDN or CMS',
    optional: true,
  },
  slug: {
    type: 'string',
    description: 'Identifier of the category',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PILOTERR_TECHNOLOGY_OUTPUT_PROPERTIES = {
  name: {
    type: 'string',
    description: 'Name of the technology',
    optional: true,
  },
  slug: {
    type: 'string',
    description: 'Identifier of the technology',
    optional: true,
  },
  version: {
    type: 'string',
    description: 'Version, when it can be detected',
    optional: true,
  },
  website: {
    type: 'string',
    description: 'Website of the technology',
    optional: true,
  },
  description: {
    type: 'string',
    description: 'What the technology does',
    optional: true,
  },
  confidence: {
    type: 'number',
    description: 'Confidence of the detection, from 0 to 100',
    optional: true,
  },
  categories: {
    type: 'array',
    description: 'Categories of the technology',
    optional: true,
    items: { type: 'object', properties: PILOTERR_TECHNOLOGY_CATEGORY_OUTPUT_PROPERTIES },
  },
} as const satisfies Record<string, OutputProperty>

export const PILOTERR_SEARCH_RESULT_OUTPUT_PROPERTIES = {
  position: {
    type: 'number',
    description: 'Position of the result on the page',
    optional: true,
  },
  title: {
    type: 'string',
    description: 'Title of the result',
    optional: true,
  },
  link: {
    type: 'string',
    description: 'URL of the result',
    optional: true,
  },
  domain: {
    type: 'string',
    description: 'Domain of the result',
    optional: true,
  },
  displayedLink: {
    type: 'string',
    description: 'Link as Google displays it',
    optional: true,
  },
  source: {
    type: 'string',
    description: 'Source or site name',
    optional: true,
  },
  snippet: {
    type: 'string',
    description: 'Snippet shown under the title',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PILOTERR_AMAZON_PRODUCT_OUTPUT_PROPERTIES = {
  asin: {
    type: 'string',
    description: 'ASIN of the product',
    optional: true,
  },
  title: {
    type: 'string',
    description: 'Title of the product',
    optional: true,
  },
  url: {
    type: 'string',
    description: 'URL of the product page',
    optional: true,
  },
  price: {
    type: 'number',
    description: 'Price shown in the results',
    optional: true,
  },
  realPrice: {
    type: 'number',
    description: 'List price before discount, when shown',
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

export const PILOTERR_EBAY_SELLER_OUTPUT_PROPERTIES = {
  name: {
    type: 'string',
    description: 'Name of the seller',
    optional: true,
  },
  feedback: {
    type: 'string',
    description: 'Feedback count of the seller',
    optional: true,
  },
  positiveFeedbackPercent: {
    type: 'number',
    description: 'Share of positive feedback, in percent',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PILOTERR_EBAY_SPECIFICATION_OUTPUT_PROPERTIES = {
  name: {
    type: 'string',
    description: 'Name of the specific',
    optional: true,
  },
  value: {
    type: 'string',
    description: 'Value of the specific',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PILOTERR_EBAY_LISTING_OUTPUT_PROPERTIES = {
  position: {
    type: 'number',
    description: 'Position of the listing on the page',
    optional: true,
  },
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
  subtitle: {
    type: 'string',
    description: 'Subtitle of the listing',
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
    description: 'Condition of the item',
    optional: true,
  },
  buyingFormat: {
    type: 'string',
    description: 'Buying format, such as Buy It Now or Auction',
    optional: true,
  },
  shipping: {
    type: 'string',
    description: 'Shipping cost or summary',
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
} as const satisfies Record<string, OutputProperty>

export const PILOTERR_LINKEDIN_HEADQUARTER_OUTPUT_PROPERTIES = {
  line1: {
    type: 'string',
    description: 'Street address',
    optional: true,
  },
  city: {
    type: 'string',
    description: 'City',
    optional: true,
  },
  postalCode: {
    type: 'string',
    description: 'Postal code',
    optional: true,
  },
  country: {
    type: 'string',
    description: 'Country code',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PILOTERR_LINKEDIN_COMPANY_LINK_OUTPUT_PROPERTIES = {
  companyName: {
    type: 'string',
    description: 'Name of the company',
    optional: true,
  },
  companyUrl: {
    type: 'string',
    description: 'URL of its LinkedIn page',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PILOTERR_CRUNCHBASE_CATEGORY_OUTPUT_PROPERTIES = {
  name: {
    type: 'string',
    description: 'Name of the category',
    optional: true,
  },
  permalink: {
    type: 'string',
    description: 'Crunchbase permalink of the category',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PILOTERR_CRUNCHBASE_LOCATION_OUTPUT_PROPERTIES = {
  name: {
    type: 'string',
    description: 'Name of the place',
    optional: true,
  },
  type: {
    type: 'string',
    description: 'Type of place, such as city or country',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PILOTERR_CRUNCHBASE_INVESTOR_OUTPUT_PROPERTIES = {
  name: {
    type: 'string',
    description: 'Name of the investor',
    optional: true,
  },
  permalink: {
    type: 'string',
    description: 'Crunchbase permalink of the investor',
    optional: true,
  },
  fundingRound: {
    type: 'string',
    description: 'Funding round the investor took part in',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PILOTERR_CRUNCHBASE_PRODUCT_OUTPUT_PROPERTIES = {
  name: {
    type: 'string',
    description: 'Name of the product',
    optional: true,
  },
  description: {
    type: 'string',
    description: 'Description of the product',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const PILOTERR_ZILLOW_PHOTO_OUTPUT_PROPERTIES = {
  url: {
    type: 'string',
    description: 'URL of the photo',
    optional: true,
  },
  width: {
    type: 'number',
    description: 'Width of the photo in pixels',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface PiloterrFetchHtmlParams {
  apiKey: string
  url: string
}

export interface PiloterrFetchHtmlResponse extends ToolResponse {
  output: {
    html: string | null
  }
}

export interface PiloterrRenderHtmlParams {
  apiKey: string
  url: string
  waitInSeconds?: number
  blockAds?: boolean
}

export interface PiloterrRenderHtmlResponse extends ToolResponse {
  output: {
    html: string | null
  }
}

export interface PiloterrScreenshotParams {
  apiKey: string
  url: string
  format?: string
  fullPage?: boolean
  device?: string
  selector?: string
  viewportWidth?: number
  viewportHeight?: number
  delay?: number
  removeCookieBanners?: boolean
  removeAds?: boolean
}

export interface PiloterrScreenshotResponse extends ToolResponse {
  output: {
    file: ToolFileData
  }
}

export interface PiloterrDetectTechnologiesParams {
  apiKey: string
  url: string
}

export interface PiloterrDetectTechnologiesResponse extends ToolResponse {
  output: {
    technologies: PiloterrTechnology[]
  }
}

export interface PiloterrGoogleSearchParams {
  apiKey: string
  query: string
  country?: string
  language?: string
  location?: string
  page?: number
  numResults?: number
}

export interface PiloterrGoogleSearchResponse extends ToolResponse {
  output: {
    results: PiloterrSearchResult[]
    totalResults: number | null
    hasNextPage: boolean | null
  }
}

export interface PiloterrAmazonSearchParams {
  apiKey: string
  query: string
  marketplace?: string
  page?: number
}

export interface PiloterrAmazonSearchResponse extends ToolResponse {
  output: {
    products: PiloterrAmazonProduct[]
  }
}

export interface PiloterrEbayGetListingParams {
  apiKey: string
  item: string
}

export interface PiloterrEbayGetListingResponse extends ToolResponse {
  output: {
    itemId: string | null
    title: string | null
    url: string | null
    price: number | null
    currency: string | null
    priceDisplay: string | null
    condition: string | null
    conditionDescription: string | null
    availability: string | null
    isBuyItNow: boolean | null
    isBestOffer: boolean | null
    watchers: number | null
    imageUrl: string | null
    seller: PiloterrEbaySeller | null
    shipping: string | null
    returns: string | null
    specifications: PiloterrEbaySpecification[]
    paymentMethods: string[]
  }
}

export interface PiloterrEbaySearchParams {
  apiKey: string
  query: string
  page?: number
}

export interface PiloterrEbaySearchResponse extends ToolResponse {
  output: {
    listings: PiloterrEbayListing[]
    nextPageUrl: string | null
    page: number | null
  }
}

export interface PiloterrLinkedinCompanyParams {
  apiKey: string
  query?: string
  domain?: string
}

export interface PiloterrLinkedinCompanyResponse extends ToolResponse {
  output: {
    companyName: string | null
    companyId: number | null
    companyUrl: string | null
    tagline: string | null
    description: string | null
    website: string | null
    industry: string | null
    founded: number | null
    staffCount: number | null
    staffRange: string | null
    followerCount: number | null
    logoUrl: string | null
    specialities: string[]
    locations: string[]
    headquarter: PiloterrLinkedinHeadquarter | null
    similarCompanies: PiloterrLinkedinCompanyLink[]
  }
}

export interface PiloterrCrunchbaseCompanyParams {
  apiKey: string
  query?: string
  domain?: string
}

export interface PiloterrCrunchbaseCompanyResponse extends ToolResponse {
  output: {
    name: string | null
    permalink: string | null
    headline: string | null
    description: string | null
    website: string | null
    logo: string | null
    companyType: string | null
    employeeCount: string | null
    foundedOn: string | null
    phoneNumber: string | null
    contactEmail: string | null
    heatScore: number | null
    growthScore: number | null
    aliases: string[]
    tags: string[]
    categories: PiloterrCrunchbaseCategory[]
    headquartersLocation: PiloterrCrunchbaseLocation[]
    investors: PiloterrCrunchbaseInvestor[]
    products: PiloterrCrunchbaseProduct[]
  }
}

export interface PiloterrZillowPropertyParams {
  apiKey: string
  url: string
}

export interface PiloterrZillowPropertyResponse extends ToolResponse {
  output: {
    zpid: number | null
    streetAddress: string | null
    city: string | null
    state: string | null
    zipcode: string | null
    county: string | null
    price: number | null
    currency: string | null
    zestimate: number | null
    homeStatus: string | null
    homeType: string | null
    bedrooms: number | null
    bathrooms: number | null
    livingArea: number | null
    lotSize: number | null
    yearBuilt: number | null
    pricePerSquareFoot: number | null
    description: string | null
    latitude: number | null
    longitude: number | null
    photos: PiloterrZillowPhoto[]
  }
}
