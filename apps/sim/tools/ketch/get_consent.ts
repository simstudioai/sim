import type { KetchGetConsentParams, KetchGetConsentResponse } from '@/tools/ketch/types'
import { CONSENT_PURPOSE_OUTPUT_PROPERTIES } from '@/tools/ketch/types'
import type { ToolConfig } from '@/tools/types'

export const getConsentTool: ToolConfig<KetchGetConsentParams, KetchGetConsentResponse> = {
  id: 'ketch_get_consent',
  name: 'Ketch Get Consent',
  description:
    'Retrieve consent status for a data subject. Returns the current consent preferences for each configured purpose.',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional purposes to filter the consent query',
    },
  },

  request: {
    url: (params) =>
      `https://global.ketchcdn.com/web/v2/consent/${encodeURIComponent(params.organizationCode.trim())}/get`,
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
      }
      if (params.jurisdictionCode) body.jurisdictionCode = params.jurisdictionCode
      if (params.purposes) body.purposes = params.purposes
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      let errorMessage = `Request failed with status ${response.status}`
      try {
        const data = await response.json()
        errorMessage = data.message ?? data.error ?? errorMessage
      } catch {
        // No JSON body in error response
      }
      return {
        success: false,
        output: {
          error: errorMessage,
          purposes: {},
          vendors: null,
        },
      }
    }

    const data = await response.json()
    return {
      success: true,
      output: {
        purposes: data.purposes ?? {},
        vendors: data.vendors ?? null,
      },
    }
  },

  outputs: {
    purposes: {
      type: 'object',
      description: 'Map of purpose codes to consent status and legal basis',
      properties: CONSENT_PURPOSE_OUTPUT_PROPERTIES,
    },
    vendors: {
      type: 'object',
      description: 'Map of vendor consent statuses',
      optional: true,
    },
  },
}
