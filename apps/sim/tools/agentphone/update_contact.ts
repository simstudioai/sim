import type {
  AgentPhoneUpdateContactParams,
  AgentPhoneUpdateContactResult,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneUpdateContactTool: ToolConfig<
  AgentPhoneUpdateContactParams,
  AgentPhoneUpdateContactResult
> = {
  id: 'agentphone_update_contact',
  name: 'Update Contact',
  description: "Update a contact's fields",
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentPhone API key',
    },
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Contact ID',
    },
    phoneNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New phone number in E.164 format',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New contact name',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New email address',
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New freeform notes',
    },
  },

  request: {
    url: (params) => `https://api.agentphone.to/v1/contacts/${params.contactId.trim()}`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.phoneNumber) body.phoneNumber = params.phoneNumber
      if (params.name) body.name = params.name
      if (params.email) body.email = params.email
      if (params.notes) body.notes = params.notes
      return body
    },
  },

  transformResponse: async (response): Promise<AgentPhoneUpdateContactResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to update contact',
        output: {
          id: '',
          phoneNumber: '',
          name: '',
          email: null,
          notes: null,
          createdAt: '',
          updatedAt: '',
        },
      }
    }

    return {
      success: true,
      output: {
        id: data.id ?? '',
        phoneNumber: data.phoneNumber ?? '',
        name: data.name ?? '',
        email: data.email ?? null,
        notes: data.notes ?? null,
        createdAt: data.createdAt ?? '',
        updatedAt: data.updatedAt ?? '',
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Contact ID' },
    phoneNumber: { type: 'string', description: 'Phone number in E.164 format' },
    name: { type: 'string', description: 'Contact name' },
    email: { type: 'string', description: 'Contact email address', optional: true },
    notes: { type: 'string', description: 'Freeform notes', optional: true },
    createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
    updatedAt: { type: 'string', description: 'ISO 8601 update timestamp' },
  },
}
