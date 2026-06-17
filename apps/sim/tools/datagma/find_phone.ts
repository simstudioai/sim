import { datagmaHosting } from '@/tools/datagma/hosting'
import type { DatagmaFindPhoneParams, DatagmaFindPhoneResponse } from '@/tools/datagma/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Find a mobile phone number from a LinkedIn URL (and optional email).
 *
 * Endpoint: GET https://gateway.datagma.net/api/ingress/v1/search
 * Auth: apiId query param
 * Docs: https://datagmaapi.readme.io/reference/find-a-phone-number
 * Pricing: 30 credits per phone number found (same credit unit as email; 1 email = 1 credit)
 * Pricing source: https://datagma.com/pricing ("30 credits = 1 mobile phone number")
 */
export const findPhoneTool: ToolConfig<DatagmaFindPhoneParams, DatagmaFindPhoneResponse> = {
  id: 'datagma_find_phone',
  name: 'Datagma Find Phone',
  description:
    "Find a mobile phone number from a person's LinkedIn URL. Optionally supply an email to improve match accuracy. Uses 30 credits when a number is found.",
  version: '1.0.0',

  hosting: datagmaHosting<DatagmaFindPhoneParams>((_params, output) => {
    const phone = output.phone as string | null
    return phone ? 30 : 0
  }),

  params: {
    username: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "LinkedIn URL of the person (e.g., 'https://linkedin.com/in/johndoe')",
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address to improve phone match accuracy',
    },
    minimumMatch: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum match confidence threshold (0–1; default 1 for highest precision)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Datagma API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://gateway.datagma.net/api/ingress/v1/search')
      url.searchParams.set('apiId', params.apiKey)
      url.searchParams.set('username', params.username)
      if (params.email) url.searchParams.set('email', params.email)
      if (params.minimumMatch != null)
        url.searchParams.set('minimumMatch', String(params.minimumMatch))
      // Always request WhatsApp verification since we surface isWhatsapp in the output
      url.searchParams.set('whatsappCheck', 'true')
      return url.toString()
    },
    method: 'GET',
    headers: () => ({ Accept: 'application/json' }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as Record<string, string>).message ||
          `Datagma API error: ${response.status} ${response.statusText}`,
        output: { phone: null, countryCode: null, isWhatsapp: null },
      }
    }
    const data = (await response.json()) as Record<string, unknown>

    // Phone data may be nested under a `phones` array or returned at top level
    const phones = data.phones as Array<Record<string, unknown>> | null | undefined
    const firstPhone = Array.isArray(phones) && phones.length > 0 ? phones[0] : null

    return {
      success: true,
      output: {
        phone: firstPhone
          ? ((firstPhone.number as string | null) ?? null)
          : ((data.phone as string | null) ?? null),
        countryCode: firstPhone
          ? ((firstPhone.countryCode as string | null) ?? null)
          : ((data.countryCode as string | null) ?? null),
        isWhatsapp: firstPhone
          ? ((firstPhone.isWhatsapp as boolean | null) ?? null)
          : ((data.isWhatsapp as boolean | null) ?? null),
      },
    }
  },

  outputs: {
    phone: { type: 'string', description: 'Mobile phone number', optional: true },
    countryCode: { type: 'string', description: 'Country code prefix (e.g., +1)', optional: true },
    isWhatsapp: {
      type: 'boolean',
      description: 'Whether the number is linked to WhatsApp',
      optional: true,
    },
  },
}
