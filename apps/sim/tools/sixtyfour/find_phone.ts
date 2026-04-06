import type { SixtyfourFindPhoneParams, SixtyfourFindPhoneResponse } from '@/tools/sixtyfour/types'
import type { ToolConfig } from '@/tools/types'

export const sixtyfourFindPhoneTool: ToolConfig<
  SixtyfourFindPhoneParams,
  SixtyfourFindPhoneResponse
> = {
  id: 'sixtyfour_find_phone',
  name: 'Sixtyfour Find Phone',
  description: 'Find phone numbers for a lead using Sixtyfour AI.',
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
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address',
    },
  },

  request: {
    url: 'https://api.sixtyfour.ai/find-phone',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
    }),
    body: (params) => ({
      lead: {
        name: params.name,
        ...(params.company && { company: params.company }),
        ...(params.linkedinUrl && { linkedin_url: params.linkedinUrl }),
        ...(params.domain && { domain: params.domain }),
        ...(params.email && { email: params.email }),
      },
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.error || data.message || data.detail || `API error: ${response.status}`)
    }

    let phone: string | null = null
    if (typeof data.phone === 'string') {
      phone = data.phone || null
    } else if (Array.isArray(data.phone)) {
      phone = data.phone.map((p: { number: string; region?: string }) => p.number).join(', ')
    }

    return {
      success: true,
      output: {
        name: data.name ?? null,
        company: data.company ?? null,
        phone,
        linkedinUrl: data.linkedin_url ?? null,
      },
    }
  },

  outputs: {
    name: { type: 'string', description: 'Name of the person', optional: true },
    company: { type: 'string', description: 'Company name', optional: true },
    phone: { type: 'string', description: 'Phone number(s) found', optional: true },
    linkedinUrl: { type: 'string', description: 'LinkedIn profile URL', optional: true },
  },
}
