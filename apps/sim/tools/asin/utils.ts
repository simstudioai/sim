import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toRecordOrNull } from '@sim/utils/object'
import type { AsinOffer, AsinPricePoint, AsinSearchResult } from '@/tools/asin/types'

/** Reads a `AsinSearchResult` from an untyped Asin API payload. */
export function mapAsinSearchResult(value: unknown): AsinSearchResult | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    asin: toStringOrNull(record.asin),
    title: toStringOrNull(record.title),
    image: toStringOrNull(record.image),
    price: toNumberOrNull(record.price),
    currency: toStringOrNull(record.currency),
    rating: toNumberOrNull(record.rating),
    reviewsCount: toNumberOrNull(record.reviews_count),
  }
}

/** Reads a `AsinOffer` from an untyped Asin API payload. */
export function mapAsinOffer(value: unknown): AsinOffer | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    seller: toStringOrNull(record.seller),
    sellerId: toStringOrNull(record.seller_id),
    price: toNumberOrNull(record.price),
    amazon: toBooleanOrNull(record.amazon),
    fulfilledByAmazon: toBooleanOrNull(record.fulfilled_by_amazon),
    used: toBooleanOrNull(record.used),
    deliveryTime: toStringOrNull(record.delivery_time),
    deliveryPrice: toStringOrNull(record.delivery_price),
  }
}

/** Reads a `AsinPricePoint` from an untyped Asin API payload. */
export function mapAsinPricePoint(value: unknown): AsinPricePoint | null {
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
