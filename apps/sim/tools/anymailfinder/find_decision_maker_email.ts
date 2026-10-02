import {
  ANYMAILFINDER_API_BASE_URL,
  anymailFinderError,
  anymailFinderHeaders,
  anymailFinderHosting,
} from '@/tools/anymailfinder/hosting'
import type {
  AnymailFinderFindDecisionMakerEmailParams,
  AnymailFinderFindDecisionMakerEmailResponse,
} from '@/tools/anymailfinder/types'
import type { ToolConfig } from '@/tools/types'

export const findDecisionMakerEmailTool: ToolConfig<
  AnymailFinderFindDecisionMakerEmailParams,
  AnymailFinderFindDecisionMakerEmailResponse
> = {
  id: 'anymailfinder_find_decision_maker_email',
  name: 'Anymail Finder Find Decision Maker Email',
  description:
    'Find the name, job title and verified email of a decision maker in a given department at a company, when you do not know who to look for. Charges 2 credits only when a verified email is found.',
  version: '1.0.0',

  hosting: anymailFinderHosting<AnymailFinderFindDecisionMakerEmailParams>(),

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
    decision_maker_category: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'One to five departments, tried in order until a verified email is found: ceo, engineering, finance, hr, it, logistics, marketing, operations, buyer, sales (plus any custom categories on the account)',
      items: { type: 'string' },
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Anymail Finder API Key',
    },
  },

  request: {
    url: `${ANYMAILFINDER_API_BASE_URL}/find-email/decision-maker`,
    method: 'POST',
    headers: (params) => anymailFinderHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, unknown> = {
        decision_maker_category: params.decision_maker_category,
      }
      if (params.domain?.trim()) body.domain = params.domain.trim()
      if (params.company_name?.trim()) body.company_name = params.company_name.trim()
      return body
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      return {
        success: false,
        error: await anymailFinderError(response),
        output: {
          email: null,
          valid_email: null,
          email_status: 'not_found' as const,
          decision_maker_category: null,
          person_full_name: null,
          person_first_name: null,
          person_last_name: null,
          person_job_title: null,
          person_linkedin_url: null,
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
        email: data.email ?? null,
        valid_email: data.valid_email ?? null,
        email_status: data.email_status ?? 'not_found',
        decision_maker_category: data.decision_maker_category ?? null,
        person_full_name: data.person_full_name ?? null,
        person_first_name: data.person_first_name ?? null,
        person_last_name: data.person_last_name ?? null,
        person_job_title: data.person_job_title ?? null,
        person_linkedin_url: data.person_linkedin_url ?? null,
        mx_domain: data.mx_domain ?? null,
        mx_host: data.mx_host ?? null,
        credits_charged: data.credits_charged ?? 0,
      },
    }
  },

  outputs: {
    email: { type: 'string', description: 'Email address found', optional: true },
    valid_email: {
      type: 'string',
      description: 'The email address only when email_status is valid; the one to send to',
      optional: true,
    },
    email_status: { type: 'string', description: 'valid, not_found or blacklisted' },
    decision_maker_category: {
      type: 'string',
      description: 'The requested category the person was found in',
      optional: true,
    },
    person_full_name: { type: 'string', description: 'Full name', optional: true },
    person_first_name: { type: 'string', description: 'First name', optional: true },
    person_last_name: { type: 'string', description: 'Last name', optional: true },
    person_job_title: { type: 'string', description: 'Job title', optional: true },
    person_linkedin_url: { type: 'string', description: 'LinkedIn profile URL', optional: true },
    mx_domain: {
      type: 'string',
      description: 'Mail provider of the domain (e.g., google.com, outlook.com)',
      optional: true,
    },
    mx_host: { type: 'string', description: 'Primary MX hostname of the domain', optional: true },
    credits_charged: {
      type: 'number',
      description: 'Credits charged for this call (2 on a verified hit, 0 otherwise)',
    },
  },
}
