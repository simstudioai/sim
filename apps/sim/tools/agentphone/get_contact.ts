import type {
  AgentPhoneGetContactParams,
  AgentPhoneGetContactResult,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneGetContactTool: ToolConfig<
  AgentPhoneGetContactParams,
  AgentPhoneGetContactResult
> = {
  id: 'agentphone_get_contact',
  name: 'Get Contact',
  description: 'Fetch a single contact by ID',
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
  },

  request: {
    url: (params) => `https://api.agentphone.to/v1/contacts/${params.contactId.trim()}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<AgentPhoneGetContactResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to fetch contact',
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
