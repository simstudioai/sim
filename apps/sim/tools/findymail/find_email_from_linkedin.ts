import { findymailHosting } from '@/tools/findymail/hosting'
import type {
  FindymailFindEmailFromLinkedInParams,
  FindymailFindEmailFromLinkedInResponse,
} from '@/tools/findymail/types'
import { FINDYMAIL_CONTACT_OUTPUT } from '@/tools/findymail/types'
import type { ToolConfig } from '@/tools/types'

export const findEmailFromLinkedInTool: ToolConfig<
  FindymailFindEmailFromLinkedInParams,
  FindymailFindEmailFromLinkedInResponse
> = {
  id: 'findymail_find_email_from_linkedin',
  name: 'Findymail Find Email From LinkedIn',
  description:
    "Find someone's email from a LinkedIn profile URL or username. Uses one finder credit when a verified email is found.",
  version: '1.0.0',

  hosting: findymailHosting<FindymailFindEmailFromLinkedInParams>((_params, output) => {
    const contact = output.contact as { email?: string } | null
    return contact?.email ? 1 : 0
  }),

  params: {
    linkedin_url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "Person's LinkedIn URL or username (e.g., 'https://linkedin.com/in/johndoe' or 'johndoe')",
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Findymail API Key',
    },
  },

  request: {
    url: 'https://app.findymail.com/api/search/business-profile',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => ({ linkedin_url: params.linkedin_url }),
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
