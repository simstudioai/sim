import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListUsersParams {
  apiKey: string
  cursor?: string
  perPage?: number
}

interface AshbyListUsersResponse extends ToolResponse {
  output: {
    users: Array<{
      id: string
      firstName: string
      lastName: string
      email: string
      isEnabled: boolean
      globalRole: string | null
    }>
    moreDataAvailable: boolean
    nextCursor: string | null
  }
}

export const listUsersTool: ToolConfig<AshbyListUsersParams, AshbyListUsersResponse> = {
  id: 'ashby_list_users',
  name: 'Ashby List Users',
  description: 'Lists all users in Ashby with pagination.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque pagination cursor from a previous response nextCursor value',
    },
    perPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (default 100)',
    },
  },

  request: {
    url: 'https://api.ashbyhq.com/user.list',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.apiKey}:`)}`,
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.cursor) body.cursor = params.cursor
      if (params.perPage) body.limit = params.perPage
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.errorInfo?.message || 'Failed to list users')
    }

    return {
      success: true,
      output: {
        users: (data.results ?? []).map((u: Record<string, unknown>) => ({
          id: u.id ?? null,
          firstName: u.firstName ?? null,
          lastName: u.lastName ?? null,
          email: u.email ?? null,
          isEnabled: u.isEnabled ?? false,
          globalRole: u.globalRole ?? null,
        })),
        moreDataAvailable: data.moreDataAvailable ?? false,
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'List of users',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'User UUID' },
          firstName: { type: 'string', description: 'First name' },
          lastName: { type: 'string', description: 'Last name' },
          email: { type: 'string', description: 'Email address' },
          isEnabled: { type: 'boolean', description: 'Whether the user account is enabled' },
          globalRole: {
            type: 'string',
            description:
              'User role (Organization Admin, Elevated Access, Limited Access, External Recruiter)',
            optional: true,
          },
        },
      },
    },
    moreDataAvailable: {
      type: 'boolean',
      description: 'Whether more pages of results exist',
    },
    nextCursor: {
      type: 'string',
      description: 'Opaque cursor for fetching the next page',
      optional: true,
    },
  },
}
