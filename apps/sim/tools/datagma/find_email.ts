import { datagmaHosting } from '@/tools/datagma/hosting'
import type { DatagmaFindEmailParams, DatagmaFindEmailResponse } from '@/tools/datagma/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Find a verified work email address from a full name and company.
 *
 * Endpoint: GET https://gateway.datagma.net/api/ingress/v6/findEmail
 * Auth: apiId query param
 * Docs: https://datagmaapi.readme.io/reference/find-work-email-address
 * Pricing: 1 credit per verified email found (no charge for unverified/not found)
 */
export const findEmailTool: ToolConfig<DatagmaFindEmailParams, DatagmaFindEmailResponse> = {
  id: 'datagma_find_email',
  name: 'Datagma Find Email',
  description:
    "Find a verified work email from a person's full name and company. Uses 1 credit when a verified email is found.",
  version: '1.0.0',

  hosting: datagmaHosting<DatagmaFindEmailParams>((_params, output) => {
    const email = output.email as string | null
    return email ? 1 : 0
  }),

  params: {
    fullName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Person's full name (e.g., 'John Doe')",
    },
    company: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Company name or domain (e.g., 'Stripe' or 'stripe.com')",
    },
    linkedInSlug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn company URL slug to improve match accuracy by 20%+',
    },
    findEmailV2Step: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Lookup depth: 3 = full email (default), 2 = domain only',
    },
    findEmailV2Country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "User's location to improve accuracy (e.g., 'General', 'Japan', 'France')",
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
      const url = new URL('https://gateway.datagma.net/api/ingress/v6/findEmail')
      url.searchParams.set('apiId', params.apiKey)
      url.searchParams.set('fullName', params.fullName)
      url.searchParams.set('company', params.company)
      if (params.linkedInSlug) url.searchParams.set('linkedInSlug', params.linkedInSlug)
      if (params.findEmailV2Step != null)
        url.searchParams.set('findEmailV2Step', String(params.findEmailV2Step))
      if (params.findEmailV2Country)
        url.searchParams.set('findEmailV2Country', params.findEmailV2Country)
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
        output: {
          email: null,
          emailStatus: null,
          emailDomain: null,
          mxfound: null,
          smtpCheck: null,
          catchAll: null,
        },
      }
    }
    const data = (await response.json()) as Record<string, unknown>
    return {
      success: true,
      output: {
        email: (data.email as string | null) ?? null,
        emailStatus: (data.status as string | null) ?? null,
        emailDomain: (data.emailDomain as string | null) ?? null,
        mxfound: (data.mxfound as boolean | null) ?? null,
        smtpCheck: (data.smtpCheck as boolean | null) ?? null,
        // Datagma API spells this field "cachAll" (their documented typo); read both to be safe
        catchAll: (data.cachAll as boolean | null) ?? (data.catchAll as boolean | null) ?? null,
      },
    }
  },

  outputs: {
    email: { type: 'string', description: 'Verified work email address', optional: true },
    emailStatus: {
      type: 'string',
      description: 'Email verification status (e.g., valid, invalid)',
      optional: true,
    },
    emailDomain: { type: 'string', description: 'Email domain', optional: true },
    mxfound: { type: 'boolean', description: 'Whether MX records were found', optional: true },
    smtpCheck: {
      type: 'boolean',
      description: 'Whether SMTP validation succeeded',
      optional: true,
    },
    catchAll: { type: 'boolean', description: 'Whether the domain is catch-all', optional: true },
  },
}
