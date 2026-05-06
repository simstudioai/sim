import type {
  AgentPhoneContact,
  AgentPhoneListContactsParams,
  AgentPhoneListContactsResult,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneListContactsTool: ToolConfig<
  AgentPhoneListContactsParams,
  AgentPhoneListContactsResult
> = {
  id: 'agentphone_list_contacts',
  name: 'List Contacts',
  description: 'List contacts for this AgentPhone account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentPhone API key',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by name or phone number (case-insensitive contains)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default 50)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip (min 0)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.search) query.set('search', params.search)
      if (typeof params.limit === 'number') query.set('limit', String(params.limit))
      if (typeof params.offset === 'number') query.set('offset', String(params.offset))
      const qs = query.toString()
      return `https://api.agentphone.to/v1/contacts${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<AgentPhoneListContactsResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to list contacts',
        output: { data: [], hasMore: false, total: 0 },
      }
    }

    return {
      success: true,
      output: {
        data: (data.data ?? []).map(
          (c: Record<string, unknown>): AgentPhoneContact => ({
            id: (c.id as string) ?? '',
            phoneNumber: (c.phoneNumber as string) ?? '',
            name: (c.name as string) ?? '',
            email: (c.email as string | null) ?? null,
            notes: (c.notes as string | null) ?? null,
            createdAt: (c.createdAt as string) ?? '',
            updatedAt: (c.updatedAt as string) ?? '',
          })
        ),
        hasMore: data.hasMore ?? false,
        total: data.total ?? 0,
      },
    }
  },

  outputs: {
    data: {
      type: 'array',
      description: 'Contacts',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Contact ID' },
          phoneNumber: { type: 'string', description: 'Phone number in E.164 format' },
          name: { type: 'string', description: 'Contact name' },
          email: { type: 'string', description: 'Contact email address', optional: true },
          notes: { type: 'string', description: 'Freeform notes', optional: true },
          createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
          updatedAt: { type: 'string', description: 'ISO 8601 update timestamp' },
        },
      },
    },
    hasMore: { type: 'boolean', description: 'Whether more results are available' },
    total: { type: 'number', description: 'Total number of contacts' },
  },
}
