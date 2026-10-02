import {
  ANYMAILFINDER_API_BASE_URL,
  anymailFinderError,
  anymailFinderHeaders,
  anymailFinderHosting,
} from '@/tools/anymailfinder/hosting'
import type {
  AnymailFinderFindPersonEmailParams,
  AnymailFinderFindPersonEmailResponse,
} from '@/tools/anymailfinder/types'
import type { ToolConfig } from '@/tools/types'

export const findPersonEmailTool: ToolConfig<
  AnymailFinderFindPersonEmailParams,
  AnymailFinderFindPersonEmailResponse
> = {
  id: 'anymailfinder_find_person_email',
  name: 'Anymail Finder Find Person Email',
  description:
    "Find a person's verified work email from their name and company domain or name, or from their LinkedIn URL alone. Charges 1 credit only when a verified email is found.",
  version: '1.0.0',

  hosting: anymailFinderHosting<AnymailFinderFindPersonEmailParams>(),

  params: {
    full_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Person's full name (e.g., 'Satya Nadella'). Required together with domain or company_name unless linkedin_url is given",
    },
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
    linkedin_url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Person's LinkedIn profile URL. Can be sent on its own, or together with the name to refine the match",
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Anymail Finder API Key',
    },
  },

  request: {
    url: `${ANYMAILFINDER_API_BASE_URL}/find-email/person`,
    method: 'POST',
    headers: (params) => anymailFinderHeaders(params.apiKey),
    body: (params) => {
      const body: Record<string, string> = {}
      if (params.full_name?.trim()) body.full_name = params.full_name.trim()
      if (params.domain?.trim()) body.domain = params.domain.trim()
      if (params.company_name?.trim()) body.company_name = params.company_name.trim()
      if (params.linkedin_url?.trim()) body.linkedin_url = params.linkedin_url.trim()
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
          mx_domain: null,
          mx_host: null,
          person_full_name: null,
          person_company_name: null,
          person_job_title: null,
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
        mx_domain: data.mx_domain ?? null,
        mx_host: data.mx_host ?? null,
        person_full_name: data.person_full_name ?? null,
        person_company_name: data.person_company_name ?? null,
        person_job_title: data.person_job_title ?? null,
        credits_charged: data.credits_charged ?? 0,
      },
    }
  },

  outputs: {
    email: {
      type: 'string',
      description: 'Email address found, including risky ones that could not be verified',
      optional: true,
    },
    valid_email: {
      type: 'string',
      description: 'The email address only when email_status is valid; the one to send to',
      optional: true,
    },
    email_status: {
      type: 'string',
      description: 'valid, risky, not_found or blacklisted',
    },
    mx_domain: {
      type: 'string',
      description: 'Mail provider of the domain (e.g., google.com, outlook.com)',
      optional: true,
    },
    mx_host: { type: 'string', description: 'Primary MX hostname of the domain', optional: true },
    person_full_name: { type: 'string', description: 'Matched full name', optional: true },
    person_company_name: {
      type: 'string',
      description: 'Company name, when a LinkedIn profile was involved',
      optional: true,
    },
    person_job_title: {
      type: 'string',
      description: 'Job title, when a LinkedIn profile was involved',
      optional: true,
    },
    credits_charged: {
      type: 'number',
      description: 'Credits charged for this call (1 on a verified hit, 0 otherwise)',
    },
  },
}
