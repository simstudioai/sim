import {
  ANYMAILFINDER_API_BASE_URL,
  anymailFinderError,
  anymailFinderHeaders,
  anymailFinderHosting,
} from '@/tools/anymailfinder/hosting'
import type {
  AnymailFinderFindCompanyEmailsParams,
  AnymailFinderFindCompanyEmailsResponse,
} from '@/tools/anymailfinder/types'
import type { ToolConfig } from '@/tools/types'

export const findCompanyEmailsTool: ToolConfig<
  AnymailFinderFindCompanyEmailsParams,
  AnymailFinderFindCompanyEmailsResponse
> = {
  id: 'anymailfinder_find_company_emails',
  name: 'Anymail Finder Find Company Emails',
  description:
    'List up to 20 verified email addresses at a company, generic ones like contact@ and individual employees. Charges 1 credit for the whole list, only when at least one address is found.',
  version: '1.0.0',

  hosting: anymailFinderHosting<AnymailFinderFindCompanyEmailsParams>(),

  params: {
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company domain (e.g., microsoft.com). Preferred over company_name',
    },
    company_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name (e.g., Microsoft). Used only when domain is not provided',
    },
    email_type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "'any' (default) returns both kinds, 'generic' only role addresses like info@ or sales@, 'personal' only individual employees' work addresses",
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Anymail Finder API Key',
    },
  },

  request: {
    url: `${ANYMAILFINDER_API_BASE_URL}/find-email/company`,
    method: 'POST',
    headers: (params) => anymailFinderHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, string> = {}
      if (params.domain?.trim()) body.domain = params.domain.trim()
      if (params.company_name?.trim()) body.company_name = params.company_name.trim()
      if (params.email_type) body.email_type = params.email_type
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        error: await anymailFinderError(response),
        output: {
          emails: [],
          valid_emails: [],
          email_status: 'not_found' as const,
          mx_domain: null,
          mx_host: null,
          credits_charged: 0,
        },
      }
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        emails: Array.isArray(data.emails) ? data.emails : [],
        valid_emails: Array.isArray(data.valid_emails) ? data.valid_emails : [],
        email_status: data.email_status ?? 'not_found',
        mx_domain: data.mx_domain ?? null,
        mx_host: data.mx_host ?? null,
        // Passed through as-is: hosting.getCost refuses to bill a response without it.
        credits_charged: data.credits_charged,
      },
    }
  },

  outputs: {
    emails: {
      type: 'array',
      description: 'Email addresses found at the company (up to 20)',
      items: { type: 'string' },
    },
    valid_emails: {
      type: 'array',
      description: 'The verified subset of emails; the ones to send to',
      items: { type: 'string' },
    },
    email_status: { type: 'string', description: 'valid, risky, not_found or blacklisted' },
    mx_domain: {
      type: 'string',
      description: 'Mail provider of the domain (e.g., google.com, outlook.com)',
      optional: true,
    },
    mx_host: { type: 'string', description: 'Primary MX hostname of the domain', optional: true },
    credits_charged: {
      type: 'number',
      description:
        'Credits charged for this call (1 when verified addresses were found, 0 otherwise)',
    },
  },
}
