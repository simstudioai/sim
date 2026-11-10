import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toRecordOrNull } from '@sim/utils/object'
import type { PiloterrEbaySeller } from '@/tools/piloterr/types'

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
