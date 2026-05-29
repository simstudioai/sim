import { findymailHosting } from '@/tools/findymail/hosting'
import type {
  FindymailFindEmailsByDomainParams,
  FindymailFindEmailsByDomainResponse,
} from '@/tools/findymail/types'
import { FINDYMAIL_CONTACTS_OUTPUT } from '@/tools/findymail/types'
import type { ToolConfig } from '@/tools/types'

export const findEmailsByDomainTool: ToolConfig<
  FindymailFindEmailsByDomainParams,
  FindymailFindEmailsByDomainResponse
> = {
  id: 'findymail_find_emails_by_domain',
  name: 'Findymail Find Emails By Domain',
  description:
    'Find verified contacts at a given domain matching one or more target roles (max 3 roles). Limited to 5 concurrent synchronous requests.',
  version: '1.0.0',

  hosting: findymailHosting<FindymailFindEmailsByDomainParams>((_params, output) => {
    // No contacts array means no verified contacts returned — no charge.
    if (!Array.isArray(output.contacts)) {
      return 0
    }
    // 1 finder credit per verified contact returned.
    return output.contacts.length
  }),

  params: {
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company domain (e.g., stripe.com)',
    },
    roles: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Target roles at the company (max 3, e.g., ["CEO", "Founder"])',
      items: { type: 'string' },
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Findymail API Key',
    },
  },

  request: {
    url: 'https://app.findymail.com/api/search/domain',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => ({ domain: params.domain, roles: params.roles }),
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
        output: { contacts: [] },
      }
    }
    const data = await response.json()
    const raw = data.contacts ?? data.payload?.contacts ?? []
    const contacts = Array.isArray(raw)
      ? raw.map((c: { name?: string; email?: string; domain?: string }) => ({
          name: c.name ?? '',
          email: c.email ?? '',
          domain: c.domain ?? '',
        }))
      : []
    return { success: true, output: { contacts } }
  },

  outputs: {
    contacts: FINDYMAIL_CONTACTS_OUTPUT,
  },
}
