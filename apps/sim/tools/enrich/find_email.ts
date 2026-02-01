import type { EnrichFindEmailParams, EnrichFindEmailResponse } from '@/tools/enrich/types'
import type { ToolConfig } from '@/tools/types'

export const findEmailTool: ToolConfig<EnrichFindEmailParams, EnrichFindEmailResponse> = {
  id: 'enrich_find_email',
  name: 'Enrich Find Email',
  description: "Find a person's work email address using their full name and company domain.",
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Enrich API key',
    },
    fullName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Person's full name (e.g., John Doe)",
    },
    companyDomain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company domain (e.g., example.com)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.enrich.so/v1/api/find-email')
      url.searchParams.append('fullName', params.fullName.trim())
      url.searchParams.append('companyDomain', params.companyDomain.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    // Handle queued response (202)
    if (data.status === 'in_progress' || data.message?.includes('queued')) {
      return {
        success: true,
        output: {
          email: null,
          firstName: null,
          lastName: null,
          domain: null,
          found: false,
          acceptAll: null,
        },
      }
    }

    return {
      success: true,
      output: {
        email: data.email ?? null,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        domain: data.domain ?? null,
        found: data.found ?? false,
        acceptAll: data.acceptAll ?? null,
      },
    }
  },

  outputs: {
    email: {
      type: 'string',
      description: 'Found email address',
      optional: true,
    },
    firstName: {
      type: 'string',
      description: 'First name',
      optional: true,
    },
    lastName: {
      type: 'string',
      description: 'Last name',
      optional: true,
    },
    domain: {
      type: 'string',
      description: 'Company domain',
      optional: true,
    },
    found: {
      type: 'boolean',
      description: 'Whether an email was found',
    },
    acceptAll: {
      type: 'boolean',
      description: 'Whether the domain accepts all emails',
      optional: true,
    },
  },
}
