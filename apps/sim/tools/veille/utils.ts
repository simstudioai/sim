import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecordOrNull } from '@sim/utils/object'
import type {
  VeilleAsn,
  VeilleDns,
  VeilleIpLocation,
  VeilleMxRecord,
  VeilleWhois,
} from '@/tools/veille/types'

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

/** Reads a `VeilleAsn` from an untyped Veille API payload. */
export function mapVeilleAsn(value: unknown): VeilleAsn | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    asn: toNumberOrNull(record.asn),
    org: toStringOrNull(record.org),
    type: toStringOrNull(record.type),
    route: toStringOrNull(record.route),
    domain: toStringOrNull(record.domain),
    country: toStringOrNull(record.country),
    abuse: toStringOrNull(record.abuse),
    active: toBooleanOrNull(record.active),
  }
}

/** Reads a `VeilleIpLocation` from an untyped Veille API payload. */
export function mapVeilleIpLocation(value: unknown): VeilleIpLocation | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    city: toStringOrNull(record.city),
    state: toStringOrNull(record.state),
    country: toStringOrNull(record.country),
    countryCode: toStringOrNull(record.country_code),
    continent: toStringOrNull(record.continent),
    zip: toStringOrNull(record.zip),
    latitude: toNumberOrNull(record.latitude),
    longitude: toNumberOrNull(record.longitude),
    timezone: toStringOrNull(record.timezone),
    isEuMember: toBooleanOrNull(record.is_eu_member),
    currencyCode: toStringOrNull(record.currency_code),
  }
}

/** Reads a `VeilleWhois` from an untyped Veille API payload. */
export function mapVeilleWhois(value: unknown): VeilleWhois | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    registrar: toStringOrNull(record.registrar),
    creationDate: toStringOrNull(record.creation_date),
    updatedDate: toStringOrNull(record.updated_date),
    expirationDate: toStringOrNull(record.expiration_date),
  }
}
