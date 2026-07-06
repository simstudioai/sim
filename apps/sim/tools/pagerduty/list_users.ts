import type { PagerDutyListUsersParams, PagerDutyListUsersResponse } from '@/tools/pagerduty/types'
import type { ToolConfig } from '@/tools/types'

export const listUsersTool: ToolConfig<PagerDutyListUsersParams, PagerDutyListUsersResponse> = {
  id: 'pagerduty_list_users',
  name: 'PagerDuty List Users',
  description: 'List users from PagerDuty with an optional name/email filter.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PagerDuty REST API Key',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter users by name or email',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results (max 100)',
    },
    offset: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset to start pagination search results',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.query) query.set('query', params.query)
      if (params.limit) query.set('limit', params.limit)
      if (params.offset) query.set('offset', params.offset)
      const qs = query.toString()
      return `https://api.pagerduty.com/users${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Token token=${params.apiKey}`,
      Accept: 'application/vnd.pagerduty+json;version=2',
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || `PagerDuty API error: ${response.status}`)
    }

    return {
      success: true,
      output: {
        users: (data.users ?? []).map((u: Record<string, unknown>) => ({
          id: u.id ?? null,
          name: u.name ?? null,
          email: u.email ?? null,
          role: u.role ?? null,
          jobTitle: u.job_title ?? null,
          timeZone: u.time_zone ?? null,
          htmlUrl: u.html_url ?? null,
        })),
        total: data.total ?? null,
        more: data.more ?? false,
        offset: data.offset ?? 0,
      },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'Array of users',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'User ID' },
          name: { type: 'string', description: 'User name' },
          email: { type: 'string', description: 'User email' },
          role: { type: 'string', description: 'User role' },
          jobTitle: { type: 'string', description: 'User job title' },
          timeZone: { type: 'string', description: 'User preferred time zone' },
          htmlUrl: { type: 'string', description: 'PagerDuty web URL' },
        },
      },
    },
    total: {
      type: 'number',
      description: 'Total number of matching users (null unless explicitly requested by PagerDuty)',
      optional: true,
    },
    more: {
      type: 'boolean',
      description: 'Whether more results are available',
    },
    offset: {
      type: 'number',
      description: 'Offset used for this page of results',
    },
  },
}
