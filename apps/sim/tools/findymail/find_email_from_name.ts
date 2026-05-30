import { findymailHosting } from '@/tools/findymail/hosting'
import type {
  FindymailFindEmailFromNameParams,
  FindymailFindEmailFromNameResponse,
} from '@/tools/findymail/types'
import { FINDYMAIL_CONTACT_OUTPUT } from '@/tools/findymail/types'
import type { ToolConfig } from '@/tools/types'

export const findEmailFromNameTool: ToolConfig<
  FindymailFindEmailFromNameParams,
  FindymailFindEmailFromNameResponse
> = {
  id: 'findymail_find_email_from_name',
  name: 'Findymail Find Email From Name',
  description:
    "Find someone's email from their name and a company domain or company name. Uses one finder credit when a verified email is found.",
  version: '1.0.0',

  hosting: findymailHosting<FindymailFindEmailFromNameParams>((_params, output) => {
    const contact = output.contact as { email?: string } | null
    return contact?.email ? 1 : 0
  }),

  params: {
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Person's full name (e.g., 'John Doe')",
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Company domain (preferred) or company name (e.g., stripe.com)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Findymail API Key',
    },
  },

  request: {
    url: 'https://app.findymail.com/api/search/name',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => ({ name: params.name, domain: params.domain }),
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
        output: { contact: null },
      }
    }
    const data = await response.json()
    const contact = data.contact ?? data.payload?.contact ?? null
    return {
      success: true,
      output: {
        contact: contact
          ? {
              name: contact.name ?? '',
              email: contact.email ?? '',
              domain: contact.domain ?? '',
            }
          : null,
      },
    }
  },

  outputs: {
    contact: { ...FINDYMAIL_CONTACT_OUTPUT, optional: true },
  },
}
