import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toRecord, toRecordOrNull } from '@sim/utils/object'
import type { ToolConfig } from '@/tools/types'
import type {
  VeilleAsn,
  VeilleCheckIpParams,
  VeilleCheckIpResponse,
  VeilleIpLocation,
} from '@/tools/veille/types'
import {
  VEILLE_ASN_OUTPUT_PROPERTIES,
  VEILLE_IP_LOCATION_OUTPUT_PROPERTIES,
} from '@/tools/veille/types'

/** Reads a `VeilleAsn` from an untyped Veille API payload. */
function mapVeilleAsn(value: unknown): VeilleAsn | null {
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
function mapVeilleIpLocation(value: unknown): VeilleIpLocation | null {
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

export const veilleCheckIpTool: ToolConfig<VeilleCheckIpParams, VeilleCheckIpResponse> = {
  id: 'veille_check_ip',
  name: 'Veille Check IP',
  description:
    'Check an IPv4 or IPv6 address for VPN, proxy, Tor exit, datacenter, abuse and crawler traffic, with its network owner, location and a 0-100 threat score.',
  version: '1.0.0',

  params: {
    ip: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The IPv4 or IPv6 address (e.g., "8.8.8.8")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Veille API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.veille.io/v1/intelligence/ip`)
      url.searchParams.set('query', params.ip.trim())
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
        ip: toStringOrNull(data.ip),
        threatScore: toNumberOrNull(data.threat_score),
        isVpn: toBooleanOrNull(data.is_vpn),
        isProxy: toBooleanOrNull(data.is_proxy),
        isTor: toBooleanOrNull(data.is_tor),
        isDatacenter: toBooleanOrNull(data.is_datacenter),
        isAbuser: toBooleanOrNull(data.is_abuser),
        isCrawler: toBooleanOrNull(data.is_crawler),
        isMobile: toBooleanOrNull(data.is_mobile),
        isBogon: toBooleanOrNull(data.is_bogon),
        asn: mapVeilleAsn(data.asn),
        location: mapVeilleIpLocation(data.location),
      },
    }
  },

  outputs: {
    ip: {
      type: 'string',
      description: 'The IP address that was checked',
      optional: true,
    },
    threatScore: {
      type: 'number',
      description: 'Threat score from 0 (safe) to 100 (risky)',
      optional: true,
    },
    isVpn: {
      type: 'boolean',
      description: 'Whether the address belongs to a VPN',
      optional: true,
    },
    isProxy: {
      type: 'boolean',
      description: 'Whether the address is a proxy',
      optional: true,
    },
    isTor: {
      type: 'boolean',
      description: 'Whether the address is a Tor exit node',
      optional: true,
    },
    isDatacenter: {
      type: 'boolean',
      description: 'Whether the address belongs to a datacenter or hosting provider',
      optional: true,
    },
    isAbuser: {
      type: 'boolean',
      description: 'Whether the address is reported for abuse',
      optional: true,
    },
    isCrawler: {
      type: 'boolean',
      description: 'Whether the address belongs to a known crawler',
      optional: true,
    },
    isMobile: {
      type: 'boolean',
      description: 'Whether the address belongs to a mobile network',
      optional: true,
    },
    isBogon: {
      type: 'boolean',
      description: 'Whether the address is a bogon (reserved or unassigned) address',
      optional: true,
    },
    asn: {
      type: 'object',
      description: 'Network that owns the address',
      optional: true,
      properties: VEILLE_ASN_OUTPUT_PROPERTIES,
    },
    location: {
      type: 'object',
      description: 'Geolocation of the address',
      optional: true,
      properties: VEILLE_IP_LOCATION_OUTPUT_PROPERTIES,
    },
  },
}
