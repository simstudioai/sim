import type {
  AgentPhoneCreateContactParams,
  AgentPhoneCreateContactResult,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneCreateContactTool: ToolConfig<
  AgentPhoneCreateContactParams,
  AgentPhoneCreateContactResult
> = {
  id: 'agentphone_create_contact',
  name: 'Create Contact',
  description: 'Create a new contact in AgentPhone',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentPhone API key',
    },
    phoneNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Phone number in E.164 format (e.g. +14155551234)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Contact's full name",
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Contact's email address",
    },
    notes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Freeform notes stored on the contact',
    },
  },

  request: {
    url: 'https://api.agentphone.to/v1/contacts',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        phoneNumber: params.phoneNumber,
        name: params.name,
      }
      if (params.email) body.email = params.email
      if (params.notes) body.notes = params.notes
      return body
    },
  },

  transformResponse: async (response): Promise<AgentPhoneCreateContactResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to create contact',
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
