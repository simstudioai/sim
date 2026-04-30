import type { AshbyUserSummary } from '@/tools/ashby/types'
import { mapUserSummary, USER_SUMMARY_OUTPUT } from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface AshbyListUsersParams {
  apiKey: string
  cursor?: string
  perPage?: number
}

interface AshbyListUsersResponse extends ToolResponse {
  output: {
    users: AshbyUserSummary[]
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
        users: (data.results ?? [])
          .map(mapUserSummary)
          .filter((u: AshbyUserSummary | null): u is AshbyUserSummary => u !== null),
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
        properties: USER_SUMMARY_OUTPUT.properties,
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
