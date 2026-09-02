import type { AshbyUserSummary } from '@/tools/ashby/types'
import {
  ashbyAuthHeaders,
  ashbyErrorMessage,
  mapUserSummary,
  USER_SUMMARY_OUTPUT,
} from '@/tools/ashby/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

interface Params {
  apiKey: string
  email: string
}
interface Response extends ToolResponse {
  output: { users: AshbyUserSummary[] }
}
export const searchUsersTool: ToolConfig<Params, Response> = {
  id: 'ashby_search_users',
  name: 'Ashby Search Users',
  description: 'Searches Ashby users by exact email address.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ashby API Key',
    },
    email: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'User email address',
    },
  },
  request: {
    url: 'https://api.ashbyhq.com/user.search',
    method: 'POST',
    headers: (p) => ashbyAuthHeaders(p.apiKey),
    body: (p) => ({ email: p.email.trim() }),
  },
  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) throw new Error(ashbyErrorMessage(data, 'Failed to search users'))
    return {
      success: true,
      output: {
        users: (data.results ?? [])
          .map(mapUserSummary)
          .filter((u: AshbyUserSummary | null): u is AshbyUserSummary => u !== null),
      },
    }
  },
  outputs: {
    users: {
      type: 'array',
      description: 'Matching users',
      items: { type: 'object', properties: USER_SUMMARY_OUTPUT.properties },
    },
  },
}
