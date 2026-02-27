import type { LoopsUpdateContactParams, LoopsUpdateContactResponse } from '@/tools/loops/types'
import type { ToolConfig } from '@/tools/types'

export const loopsUpdateContactTool: ToolConfig<
  LoopsUpdateContactParams,
  LoopsUpdateContactResponse
> = {
  id: 'loops_update_contact',
  name: 'Loops Update Contact',
  description:
    'Update an existing contact in Loops by email or userId. Creates a new contact if no match is found (upsert). Can update name, subscription status, user group, mailing lists, and custom properties.',
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
      description: 'The contact email address (at least one of email or userId is required)',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The contact userId (at least one of email or userId is required)',
    },
    firstName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The contact first name',
    },
    lastName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The contact last name',
    },
    source: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom source value replacing the default "API"',
    },
    subscribed: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Whether the contact receives campaign emails (sending true re-subscribes unsubscribed contacts)',
    },
    userGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Group to segment the contact into (one group per contact)',
    },
    mailingLists: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Mailing list IDs mapped to boolean values (true to subscribe, false to unsubscribe)',
    },
    customProperties: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom contact properties as key-value pairs (send null to reset a property)',
    },
  },

  request: {
    url: 'https://app.loops.so/api/v1/contacts/update',
    method: 'PUT',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      if (!params.email && !params.userId) {
        throw new Error('At least one of email or userId is required to update a contact')
      }

      // Apply custom properties first so standard fields always take precedence
      const body: Record<string, unknown> = {}

      if (params.customProperties) {
        const props =
          typeof params.customProperties === 'string'
            ? JSON.parse(params.customProperties)
            : params.customProperties
        Object.assign(body, props)
      }

      if (params.email) body.email = params.email
      if (params.userId) body.userId = params.userId
      if (params.firstName) body.firstName = params.firstName
      if (params.lastName) body.lastName = params.lastName
      if (params.source) body.source = params.source
      if (params.subscribed != null) body.subscribed = params.subscribed
      if (params.userGroup) body.userGroup = params.userGroup

      if (params.mailingLists) {
        body.mailingLists =
          typeof params.mailingLists === 'string'
            ? JSON.parse(params.mailingLists)
            : params.mailingLists
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          success: false,
          id: null,
        },
        error: data.message ?? 'Failed to update contact',
      }
    }

    return {
      success: true,
      output: {
        success: true,
        id: data.id ?? null,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the contact was updated successfully' },
    id: {
      type: 'string',
      description: 'The Loops-assigned ID of the updated or created contact',
      optional: true,
    },
  },
}
