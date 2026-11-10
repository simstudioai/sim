import { toBooleanOrNull, toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import type { ToolConfig } from '@/tools/types'
import type { VeilleCheckEmailParams, VeilleCheckEmailResponse } from '@/tools/veille/types'
import { VEILLE_DNS_OUTPUT_PROPERTIES } from '@/tools/veille/types'
import { mapVeilleDns } from '@/tools/veille/utils'

export const veilleCheckEmailTool: ToolConfig<VeilleCheckEmailParams, VeilleCheckEmailResponse> = {
  id: 'veille_check_email',
  name: 'Veille Check Email',
  description:
    'Check an email address without an SMTP test: disposable or temporary inbox, role account, public webmail, relay or alias, DNS health and a 0-100 risk score.',
  version: '1.0.0',

  params: {
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The email address to check (e.g., "jane@company.com")',
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
      const url = new URL(`https://api.veille.io/v1/intelligence/email`)
      url.searchParams.set('query', params.email.trim())
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
        email: toStringOrNull(data.email),
        normalizedEmail: toStringOrNull(data.normalized_email),
        domain: toStringOrNull(data.domain),
        riskScore: toNumberOrNull(data.risk_score),
        disposable: toBooleanOrNull(data.disposable),
        roleAccount: toBooleanOrNull(data.role_account),
        roleType: toStringOrNull(data.role_type),
        publicDomain: toBooleanOrNull(data.public_domain),
        relayDomain: toBooleanOrNull(data.relay_domain),
        isAlias: toBooleanOrNull(data.is_alias),
        education: toBooleanOrNull(data.education),
        hasGravatar: toBooleanOrNull(data.has_gravatar),
        dns: mapVeilleDns(data.dns),
      },
    }
  },

  outputs: {
    email: {
      type: 'string',
      description: 'The email address that was checked',
      optional: true,
    },
    normalizedEmail: {
      type: 'string',
      description: 'The address in lowercase, as checked',
      optional: true,
    },
    domain: {
      type: 'string',
      description: 'Domain of the address',
      optional: true,
    },
    riskScore: {
      type: 'number',
      description: 'Risk score from 0 (safe) to 100 (risky)',
      optional: true,
    },
    disposable: {
      type: 'boolean',
      description: 'Whether the address uses a disposable or temporary inbox',
      optional: true,
    },
    roleAccount: {
      type: 'boolean',
      description: 'Whether the address is a role account, such as contact@ or support@',
      optional: true,
    },
    roleType: {
      type: 'string',
      description: 'Role of a role account, such as contact or support',
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
    isAlias: {
      type: 'boolean',
      description: 'Whether the address is an alias, such as a plus address',
      optional: true,
    },
    education: {
      type: 'boolean',
      description: 'Whether the domain belongs to an education institution',
      optional: true,
    },
    hasGravatar: {
      type: 'boolean',
      description: 'Whether the address has a Gravatar profile',
      optional: true,
    },
    dns: {
      type: 'object',
      description: 'DNS health of the domain: MX, SPF and DMARC records',
      optional: true,
      properties: VEILLE_DNS_OUTPUT_PROPERTIES,
    },
  },
}
