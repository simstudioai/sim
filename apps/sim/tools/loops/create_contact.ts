import type { LoopsCreateContactParams, LoopsCreateContactResponse } from '@/tools/loops/types'
import type { ToolConfig } from '@/tools/types'

export const loopsCreateContactTool: ToolConfig<
  LoopsCreateContactParams,
  LoopsCreateContactResponse
> = {
  id: 'loops_create_contact',
  name: 'Loops Create Contact',
  description:
    'Create a new contact in your Loops audience with an email address and optional properties like name, user group, and mailing list subscriptions.',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'The email address for the new contact',
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
      description: 'Whether the contact receives campaign emails (defaults to true)',
    },
    userGroup: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Group to segment the contact into (one group per contact)',
    },
    userId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unique user identifier from your application',
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
      description:
        'Custom contact properties as key-value pairs (string, number, boolean, or date values)',
    },
  },

  request: {
    url: 'https://app.loops.so/api/v1/contacts/create',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      // Apply custom properties first so standard fields always take precedence
      const body: Record<string, unknown> = {}

      if (params.customProperties) {
        const props =
          typeof params.customProperties === 'string'
            ? JSON.parse(params.customProperties)
            : params.customProperties
        Object.assign(body, props)
      }

      body.email = params.email
      if (params.firstName) body.firstName = params.firstName
      if (params.lastName) body.lastName = params.lastName
      if (params.source) body.source = params.source
      if (params.subscribed != null) body.subscribed = params.subscribed
      if (params.userGroup) body.userGroup = params.userGroup
      if (params.userId) body.userId = params.userId

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
        error: data.message ?? 'Failed to create contact',
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
    success: { type: 'boolean', description: 'Whether the contact was created successfully' },
    id: {
      type: 'string',
      description: 'The Loops-assigned ID of the created contact',
      optional: true,
    },
  },
}
