import type { SixtyfourFindEmailParams, SixtyfourFindEmailResponse } from '@/tools/sixtyfour/types'
import type { ToolConfig } from '@/tools/types'

function parseEmails(emailField: unknown): { address: string; status: string; type: string }[] {
  if (!Array.isArray(emailField)) return []
  return emailField.map((entry: unknown) => {
    if (Array.isArray(entry)) {
      return {
        address: entry[0] ?? '',
        status: entry[1] ?? 'UNKNOWN',
        type: entry[2] ?? 'UNKNOWN',
      }
    }
    return { address: String(entry), status: 'UNKNOWN', type: 'UNKNOWN' }
  })
}

export const sixtyfourFindEmailTool: ToolConfig<
  SixtyfourFindEmailParams,
  SixtyfourFindEmailResponse
> = {
  id: 'sixtyfour_find_email',
  name: 'Sixtyfour Find Email',
  description: 'Find email addresses for a lead using Sixtyfour AI.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sixtyfour API key',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Full name of the person',
    },
    company: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company name',
    },
    linkedinUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Company website domain',
    },
    phone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Phone number',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Job title',
    },
    mode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email discovery mode: PROFESSIONAL (default) or PERSONAL',
    },
  },

  request: {
    url: 'https://api.sixtyfour.ai/find-email',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => ({
      lead: {
        name: params.name,
        ...(params.company && { company: params.company }),
        ...(params.linkedinUrl && { linkedin: params.linkedinUrl }),
        ...(params.domain && { domain: params.domain }),
        ...(params.phone && { phone: params.phone }),
        ...(params.title && { title: params.title }),
      },
      ...(params.mode && { mode: params.mode }),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || data.message || data.detail || `API error: ${response.status}`)
    }

    return {
      success: true,
      output: {
        name: data.name ?? null,
        company: data.company ?? null,
        title: data.title ?? null,
        phone: data.phone ?? null,
        linkedinUrl: data.linkedin ?? null,
        emails: parseEmails(data.email),
        personalEmails: parseEmails(data.personal_email),
      },
    }
  },

  outputs: {
    name: { type: 'string', description: 'Name of the person', optional: true },
    company: { type: 'string', description: 'Company name', optional: true },
    title: { type: 'string', description: 'Job title', optional: true },
    phone: { type: 'string', description: 'Phone number', optional: true },
    linkedinUrl: { type: 'string', description: 'LinkedIn profile URL', optional: true },
    emails: {
      type: 'json',
      description: 'Professional email addresses found',
      properties: {
        address: { type: 'string', description: 'Email address' },
        status: { type: 'string', description: 'Validation status (OK or UNKNOWN)' },
        type: { type: 'string', description: 'Email type (COMPANY or PERSONAL)' },
      },
    },
    personalEmails: {
      type: 'json',
      description: 'Personal email addresses found (only in PERSONAL mode)',
      optional: true,
      properties: {
        address: { type: 'string', description: 'Email address' },
        status: { type: 'string', description: 'Validation status (OK or UNKNOWN)' },
        type: { type: 'string', description: 'Email type (COMPANY or PERSONAL)' },
      },
    },
  },
}
