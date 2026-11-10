import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord, toRecordOrNull } from '@sim/utils/object'
import type {
  PiloterrAmazonProduct,
  PiloterrCrunchbaseCategory,
  PiloterrCrunchbaseInvestor,
  PiloterrCrunchbaseLocation,
  PiloterrCrunchbaseProduct,
  PiloterrEbayListing,
  PiloterrEbaySeller,
  PiloterrEbaySpecification,
  PiloterrLinkedinCompanyLink,
  PiloterrLinkedinHeadquarter,
  PiloterrSearchResult,
  PiloterrTechnology,
  PiloterrTechnologyCategory,
  PiloterrZillowPhoto,
} from '@/tools/piloterr/types'

/** Reads a `PiloterrTechnologyCategory` from an untyped Piloterr API payload. */
function mapPiloterrTechnologyCategory(value: unknown): PiloterrTechnologyCategory | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    name: toStringOrNull(record.name),
    slug: toStringOrNull(record.slug),
  }
}

/** Reads a `PiloterrTechnology` from an untyped Piloterr API payload. */
export function mapPiloterrTechnology(value: unknown): PiloterrTechnology | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    name: toStringOrNull(record.name),
    slug: toStringOrNull(record.slug),
    version: toStringOrNull(record.version),
    website: toStringOrNull(record.website),
    description: toStringOrNull(record.description),
    confidence: toNumberOrNull(record.confidence),
    categories: toArray(record.categories)
      .map(mapPiloterrTechnologyCategory)
      .filter((item): item is PiloterrTechnologyCategory => item !== null),
  }
}

/** Reads a `PiloterrSearchResult` from an untyped Piloterr API payload. */
export function mapPiloterrSearchResult(value: unknown): PiloterrSearchResult | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    position: toNumberOrNull(record.position),
    title: toStringOrNull(record.title),
    link: toStringOrNull(record.link),
    domain: toStringOrNull(record.domain),
    displayedLink: toStringOrNull(record.displayed_link),
    source: toStringOrNull(record.source),
    snippet: toStringOrNull(record.snippet),
  }
}

/** Reads a `PiloterrAmazonProduct` from an untyped Piloterr API payload. */
export function mapPiloterrAmazonProduct(value: unknown): PiloterrAmazonProduct | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    asin: toStringOrNull(record.asin),
    title: toStringOrNull(record.title),
    url: toStringOrNull(record.url),
    price: toNumberOrNull(record.price),
    realPrice: toNumberOrNull(record.real_price),
    rating: toNumberOrNull(record.rating),
    reviewsCount: toNumberOrNull(record.reviews_count),
  }
}

/** Reads a `PiloterrEbaySeller` from an untyped Piloterr API payload. */
export function mapPiloterrEbaySeller(value: unknown): PiloterrEbaySeller | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    name: toStringOrNull(record.name),
    feedback: toStringOrNull(record.feedback),
    positiveFeedbackPercent: toNumberOrNull(record.positive_feedback_percent),
  }
}

/** Reads a `PiloterrEbaySpecification` from an untyped Piloterr API payload. */
export function mapPiloterrEbaySpecification(value: unknown): PiloterrEbaySpecification | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    name: toStringOrNull(record.name),
    value: toStringOrNull(record.value),
  }
}

/** Reads a `PiloterrEbayListing` from an untyped Piloterr API payload. */
export function mapPiloterrEbayListing(value: unknown): PiloterrEbayListing | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    position: toNumberOrNull(record.position),
    itemId: toStringOrNull(record.item_id),
    title: toStringOrNull(record.title),
    subtitle: toStringOrNull(record.subtitle),
    url: toStringOrNull(record.url),
    price: toNumberOrNull(record.price),
    currency: toStringOrNull(record.currency),
    priceDisplay: toStringOrNull(record.price_display),
    condition: toStringOrNull(record.condition),
    buyingFormat: toStringOrNull(record.buying_format),
    shipping: toStringOrNull(record.shipping),
    imageUrl: toStringOrNull(record.image_url),
    seller: mapPiloterrEbaySeller(record.seller),
  }
}

/** Reads a `PiloterrLinkedinHeadquarter` from an untyped Piloterr API payload. */
export function mapPiloterrLinkedinHeadquarter(value: unknown): PiloterrLinkedinHeadquarter | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    line1: toStringOrNull(record.line1),
    city: toStringOrNull(record.city),
    postalCode: toStringOrNull(record.postal_code),
    country: toStringOrNull(record.country),
  }
}

/** Reads a `PiloterrLinkedinCompanyLink` from an untyped Piloterr API payload. */
export function mapPiloterrLinkedinCompanyLink(value: unknown): PiloterrLinkedinCompanyLink | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    companyName: toStringOrNull(record.company_name),
    companyUrl: toStringOrNull(record.company_url),
  }
}

/** Reads a `PiloterrCrunchbaseCategory` from an untyped Piloterr API payload. */
export function mapPiloterrCrunchbaseCategory(value: unknown): PiloterrCrunchbaseCategory | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    name: toStringOrNull(record.name),
    permalink: toStringOrNull(record.permalink),
  }
}

/** Reads a `PiloterrCrunchbaseLocation` from an untyped Piloterr API payload. */
export function mapPiloterrCrunchbaseLocation(value: unknown): PiloterrCrunchbaseLocation | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    name: toStringOrNull(record.name),
    type: toStringOrNull(record.type),
  }
}

/** Reads a `PiloterrCrunchbaseInvestor` from an untyped Piloterr API payload. */
export function mapPiloterrCrunchbaseInvestor(value: unknown): PiloterrCrunchbaseInvestor | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    name: toStringOrNull(toRecord(record.investor_identifier).value),
    permalink: toStringOrNull(toRecord(record.investor_identifier).permalink),
    fundingRound: toStringOrNull(toRecord(record.funding_round_identifier).value),
  }
}

/** Reads a `PiloterrCrunchbaseProduct` from an untyped Piloterr API payload. */
export function mapPiloterrCrunchbaseProduct(value: unknown): PiloterrCrunchbaseProduct | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    name: toStringOrNull(record.name),
    description: toStringOrNull(record.description),
  }
}

/** Reads a `PiloterrZillowPhoto` from an untyped Piloterr API payload. */
export function mapPiloterrZillowPhoto(value: unknown): PiloterrZillowPhoto | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    url: toStringOrNull(record.url),
    width: toNumberOrNull(record.width),
  }
}
