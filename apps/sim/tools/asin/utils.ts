import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toRecordOrNull } from '@sim/utils/object'
import type { AsinOffer } from '@/tools/asin/types'

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
