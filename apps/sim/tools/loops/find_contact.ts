import type { LoopsFindContactParams, LoopsFindContactResponse } from '@/tools/loops/types'
import { LOOPS_CONTACT_OUTPUT_PROPERTIES } from '@/tools/loops/types'
import type { ToolConfig } from '@/tools/types'

export const loopsFindContactTool: ToolConfig<LoopsFindContactParams, LoopsFindContactResponse> = {
  id: 'loops_find_contact',
  name: 'Loops Find Contact',
  description:
    'Find a contact in Loops by email address or userId. Returns an array of matching contacts with all their properties including name, subscription status, user group, and mailing lists.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Loops API key for authentication',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The contact email address to search for (at least one of email or userId is required)',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The contact userId to search for (at least one of email or userId is required)',
    },
  },

  request: {
    url: (params) => {
      if (!params.email && !params.userId) {
        throw new Error('At least one of email or userId is required to find a contact')
      }
      const base = 'https://app.loops.so/api/v1/contacts/find'
      if (params.email) return `${base}?email=${encodeURIComponent(params.email.trim())}`
      return `${base}?userId=${encodeURIComponent(params.userId!.trim())}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!Array.isArray(data)) {
      return {
        success: false,
        output: {
          contacts: [],
        },
        error: data.message ?? 'Failed to find contact',
      }
    }

    return {
      success: true,
      output: {
        contacts: data.map((contact: Record<string, unknown>) => ({
          id: (contact.id as string) ?? '',
          email: (contact.email as string) ?? '',
          firstName: (contact.firstName as string) ?? null,
          lastName: (contact.lastName as string) ?? null,
          source: (contact.source as string) ?? null,
          subscribed: (contact.subscribed as boolean) ?? false,
          userGroup: (contact.userGroup as string) ?? null,
          userId: (contact.userId as string) ?? null,
          mailingLists: (contact.mailingLists as Record<string, boolean>) ?? {},
          optInStatus: (contact.optInStatus as string) ?? null,
        })),
      },
    }
  },

  outputs: {
    contacts: {
      type: 'array',
      description: 'Array of matching contact objects (empty array if no match found)',
      items: {
        type: 'object',
        properties: LOOPS_CONTACT_OUTPUT_PROPERTIES,
      },
    },
  },
}
