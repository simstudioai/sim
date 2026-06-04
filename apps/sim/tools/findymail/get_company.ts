import { findymailHosting } from '@/tools/findymail/hosting'
import type {
  FindymailGetCompanyParams,
  FindymailGetCompanyResponse,
} from '@/tools/findymail/types'
import type { ToolConfig } from '@/tools/types'

export const getCompanyTool: ToolConfig<FindymailGetCompanyParams, FindymailGetCompanyResponse> = {
  id: 'findymail_get_company',
  name: 'Findymail Get Company',
  description:
    'Retrieve company information from a LinkedIn URL, domain, or company name. Uses 1 finder credit per successful response.',
  version: '1.0.0',

  hosting: findymailHosting<FindymailGetCompanyParams>((_params, output) => {
    // 1 finder credit per successful company match.
    return output.name || output.domain ? 1 : 0
  }),

  params: {
    linkedin_url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company LinkedIn URL (e.g., https://www.linkedin.com/company/stripe/)',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company domain (e.g., stripe.com)',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name (e.g., Stripe)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Findymail API Key',
    },
  },

  request: {
    url: 'https://app.findymail.com/api/search/company',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, string> = {}
      if (params.linkedin_url) body.linkedin_url = params.linkedin_url
      if (params.domain) body.domain = params.domain
      if (params.name) body.name = params.name
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as Record<string, string>).message ||
          (errorData as Record<string, string>).error ||
          `Findymail API error: ${response.status} ${response.statusText}`,
        output: {
          name: null,
          domain: null,
          company_size: null,
          industry: null,
          linkedin_url: null,
          description: null,
        },
      }
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        name: data.name ?? null,
        domain: data.domain ?? null,
        company_size: data.company_size ?? null,
        industry: data.industry ?? null,
        linkedin_url: data.linkedin_url ?? null,
        description: data.description ?? null,
      },
    }
  },

  outputs: {
    name: { type: 'string', description: 'Company name', optional: true },
    domain: { type: 'string', description: 'Company domain', optional: true },
    company_size: {
      type: 'string',
      description: 'Employee headcount range (e.g., 1001-5000)',
      optional: true,
    },
    industry: { type: 'string', description: 'Industry classification', optional: true },
    linkedin_url: { type: 'string', description: 'Company LinkedIn URL', optional: true },
    description: { type: 'string', description: 'Company description', optional: true },
  },
}
