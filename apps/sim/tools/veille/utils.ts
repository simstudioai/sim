import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecordOrNull } from '@sim/utils/object'
import type { VeilleDns, VeilleMxRecord } from '@/tools/veille/types'

/** Reads a `VeilleMxRecord` from an untyped Veille API payload. */
function mapVeilleMxRecord(value: unknown): VeilleMxRecord | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    hostname: toStringOrNull(record.hostname),
    priority: toNumberOrNull(record.priority),
  }
}

/** Reads a `VeilleDns` from an untyped Veille API payload. */
export function mapVeilleDns(value: unknown): VeilleDns | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    mx: toBooleanOrNull(record.mx),
    spf: toStringOrNull(record.spf),
    spfValid: toBooleanOrNull(record.spf_valid),
    dmarc: toStringOrNull(record.dmarc),
    dmarcValid: toBooleanOrNull(record.dmarc_valid),
    mxRecords: toArray(record.mx_records)
      .map(mapVeilleMxRecord)
      .filter((item): item is VeilleMxRecord => item !== null),
  }
}
