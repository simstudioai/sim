import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord, toRecordOrNull } from '@sim/utils/object'
import type { ToolConfig } from '@/tools/types'
import type {
  VeilleCheckDomainParams,
  VeilleCheckDomainResponse,
  VeilleWhois,
} from '@/tools/veille/types'
import { VEILLE_DNS_OUTPUT_PROPERTIES, VEILLE_WHOIS_OUTPUT_PROPERTIES } from '@/tools/veille/types'
import { mapVeilleDns } from '@/tools/veille/utils'

/** Reads a `VeilleWhois` from an untyped Veille API payload. */
function mapVeilleWhois(value: unknown): VeilleWhois | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    registrar: toStringOrNull(record.registrar),
    creationDate: toStringOrNull(record.creation_date),
    updatedDate: toStringOrNull(record.updated_date),
    expirationDate: toStringOrNull(record.expiration_date),
  }
}

export const veilleCheckDomainTool: ToolConfig<VeilleCheckDomainParams, VeilleCheckDomainResponse> =
  {
    id: 'veille_check_domain',
    name: 'Veille Check Domain',
    description:
      'Check whether a domain hosts disposable, public webmail, relay or education email, with its DNS health, WHOIS dates and age.',
    version: '1.0.0',

    params: {
      domain: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'A domain, URL or email address; the domain is extracted (e.g., "mailinator.com")',
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
        const url = new URL(`https://api.veille.io/v1/intelligence/domain`)
        url.searchParams.set('query', params.domain.trim())
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
          domain: toStringOrNull(data.domain),
          disposable: toBooleanOrNull(data.disposable),
          publicDomain: toBooleanOrNull(data.public_domain),
          relayDomain: toBooleanOrNull(data.relay_domain),
          education: toBooleanOrNull(data.education),
          isSubdomain: toBooleanOrNull(data.is_subdomain),
          domainAgeDays: toNumberOrNull(data.domain_age_days),
          tags: toArray(data.tags).filter((item): item is string => typeof item === 'string'),
          sources: toArray(data.sources).filter((item): item is string => typeof item === 'string'),
          firstSeen: toStringOrNull(data.first_seen),
          lastSeen: toStringOrNull(data.last_seen),
          whois: mapVeilleWhois(data.whois),
          dns: mapVeilleDns(data.dns),
        },
      }
    },

    outputs: {
      domain: {
        type: 'string',
        description: 'The domain that was checked',
        optional: true,
      },
      disposable: {
        type: 'boolean',
        description: 'Whether the domain provides disposable or temporary inboxes',
        optional: true,
      },
      publicDomain: {
        type: 'boolean',
        description: 'Whether the domain is a public webmail provider',
        optional: true,
      },
      relayDomain: {
        type: 'boolean',
        description: 'Whether the domain is an email relay or forwarding service',
        optional: true,
      },
      education: {
        type: 'boolean',
        description: 'Whether the domain belongs to an education institution',
        optional: true,
      },
      isSubdomain: {
        type: 'boolean',
        description: 'Whether the domain is a subdomain',
        optional: true,
      },
      domainAgeDays: {
        type: 'number',
        description: 'Age of the domain in days',
        optional: true,
      },
      tags: {
        type: 'array',
        description: 'Labels for the domain, such as disposable',
        optional: true,
        items: { type: 'string' },
      },
      sources: {
        type: 'array',
        description: 'Lists that report the domain',
        optional: true,
        items: { type: 'string' },
      },
      firstSeen: {
        type: 'string',
        description: 'When Veille first saw the domain',
        optional: true,
      },
      lastSeen: {
        type: 'string',
        description: 'When Veille last saw the domain',
        optional: true,
      },
      whois: {
        type: 'object',
        description: 'Registration dates and registrar',
        optional: true,
        properties: VEILLE_WHOIS_OUTPUT_PROPERTIES,
      },
      dns: {
        type: 'object',
        description: 'DNS health of the domain: MX, SPF and DMARC records',
        optional: true,
        properties: VEILLE_DNS_OUTPUT_PROPERTIES,
      },
    },
  }
