import type { KetchSetConsentParams, KetchSetConsentResponse } from '@/tools/ketch/types'
import { CONSENT_PURPOSE_OUTPUT_PROPERTIES } from '@/tools/ketch/types'
import { readKetchErrorMessage } from '@/tools/ketch/utils'
import type { ToolConfig } from '@/tools/types'

const ALLOWED_ALIASES = new Map([
  ['true', 'true'],
  ['false', 'false'],
  ['granted', 'true'],
  ['denied', 'false'],
])

/**
 * Ketch stores `allowed` as the string `"true"` or `"false"` and records any other value
 * (including `"granted"`) as denied, so booleans and granted/denied are converted first.
 * Any other value is sent unchanged, as before.
 */
function normalizePurposes(purposes: KetchSetConsentParams['purposes']): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const [code, setting] of Object.entries(purposes ?? {})) {
    if (!setting || typeof setting !== 'object') {
      normalized[code] = setting
      continue
    }
    const allowed: unknown = setting.allowed
    const alias =
      typeof allowed === 'boolean'
        ? String(allowed)
        : typeof allowed === 'string'
          ? ALLOWED_ALIASES.get(allowed.trim().toLowerCase())
          : undefined
    normalized[code] = alias ? { ...setting, allowed: alias } : setting
  }
  return normalized
}

export const setConsentTool: ToolConfig<KetchSetConsentParams, KetchSetConsentResponse> = {
  id: 'ketch_set_consent',
  name: 'Ketch Set Consent',
  description:
    'Update consent preferences for a data subject. Sets the consent status for specified purposes with the appropriate legal basis.',
  version: '1.0.0',

  params: {
    organizationCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Ketch organization code',
    },
    propertyCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Digital property code defined in Ketch',
    },
    environmentCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Environment code defined in Ketch (e.g., "production")',
    },
    jurisdictionCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Jurisdiction code (e.g., "gdpr", "ccpa")',
    },
    identities: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identity map (e.g., {"email": "user@example.com"})',
    },
    purposes: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Map of purpose codes to consent settings. "allowed" is "true" or "false" ("granted"/"denied" are accepted and converted) (e.g., {"analytics": {"allowed": "true", "legalBasisCode": "consent_optin"}})',
    },
    collectedAt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'UNIX timestamp when consent was collected (defaults to current time)',
    },
  },

  request: {
    url: (params) =>
      `https://global.ketchcdn.com/web/v2/consent/${encodeURIComponent(params.organizationCode.trim())}/update`,
    method: 'POST',
    headers: () => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        organizationCode: params.organizationCode.trim(),
        propertyCode: params.propertyCode,
        environmentCode: params.environmentCode,
        identities: params.identities,
        purposes: normalizePurposes(params.purposes),
        collectedAt: params.collectedAt ?? Math.floor(Date.now() / 1000),
      }
      if (params.jurisdictionCode) body.jurisdictionCode = params.jurisdictionCode
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorMessage = await readKetchErrorMessage(response)
      return {
        success: false,
        output: {
          error: errorMessage,
          purposes: {},
        },
      }
    }

    if (response.status === 204) {
      return {
        success: true,
        output: {
          purposes: {},
        },
      }
    }

    const data = await response.json()
    return {
      success: true,
      output: {
        purposes: data.purposes ?? {},
      },
    }
  },

  outputs: {
    purposes: {
      type: 'object',
      description: 'Updated consent status map of purpose codes to consent settings',
      properties: CONSENT_PURPOSE_OUTPUT_PROPERTIES,
    },
  },
}
