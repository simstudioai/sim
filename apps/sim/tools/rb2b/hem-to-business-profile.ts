import {
  RB2B_BUSINESS_PROFILE_OUTPUT_PROPERTIES,
  type Rb2bBusinessProfileResponse,
  type Rb2bIdentifierParams,
} from '@/tools/rb2b/types'
import { buildIdentifierBody, RB2B_API_BASE, rb2bHeaders } from '@/tools/rb2b/utils'
import type { ToolConfig } from '@/tools/types'

export const rb2bHemToBusinessProfileTool: ToolConfig<
  Rb2bIdentifierParams,
  Rb2bBusinessProfileResponse
> = {
  id: 'rb2b_hem_to_business_profile',
  name: 'RB2B Email/HEM to Business Profile',
  description:
    'Return a full business profile (name, title, company, industry, seniority and more) for an email address or MD5-hashed email.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'RB2B API key',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'A plaintext email address or an MD5 hash of the email',
    },
  },

  request: {
    method: 'POST',
    url: `${RB2B_API_BASE}/hem_to_business_profile`,
    headers: (params) => rb2bHeaders(params.apiKey),
    body: (params) => buildIdentifierBody(params.email),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const result = data.result ?? {}
    return {
      success: true,
      output: {
        first_name: result.first_name ?? undefined,
        last_name: result.last_name ?? undefined,
        title: result.title ?? undefined,
        seniority: result.seniority ?? undefined,
        linkedinurl: result.linkedinurl ?? undefined,
        link_email: result.link_email ?? undefined,
        work_email_confirmed: result.work_email_confirmed ?? undefined,
        personal_emails: result.personal_emails ?? [],
        current_company: result.current_company ?? undefined,
        current_company_url: result.current_company_url ?? undefined,
        current_company_linkedinurl: result.current_company_linkedinurl ?? undefined,
        current_industry: result.current_industry ?? undefined,
        functional_area: result.functional_area ?? undefined,
        country: result.country ?? undefined,
        company_employee_count: result.company_employee_count ?? undefined,
        company_employee_range: result.company_employee_range ?? undefined,
        company_revenue_range: result.company_revenue_range ?? undefined,
        md5: result.md5 ?? undefined,
      },
    }
  },

  outputs: RB2B_BUSINESS_PROFILE_OUTPUT_PROPERTIES,
}
