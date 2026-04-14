import type { JiraSearchUsersParams, JiraSearchUsersResponse } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT, USER_OUTPUT_PROPERTIES } from '@/tools/jira/types'
import { getJiraCloudId, transformUser } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraSearchUsersTool: ToolConfig<JiraSearchUsersParams, JiraSearchUsersResponse> = {
  id: 'jira_search_users',
  name: 'Jira Search Users',
  description:
    'Search for Jira users by email address or display name. Returns matching users with their accountId, displayName, and emailAddress.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Jira',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Jira domain (e.g., yourcompany.atlassian.net)',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'A query string to search for users. Can be an email address, display name, or partial match.',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of users to return (default: 50, max: 1000)',
    },
    startAt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The index of the first user to return (for pagination, default: 0)',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Jira Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: (params: JiraSearchUsersParams) => {
      if (params.cloudId) {
        const queryParams = new URLSearchParams()
        queryParams.append('query', params.query)
        if (params.maxResults !== undefined)
          queryParams.append('maxResults', String(params.maxResults))
        if (params.startAt !== undefined) queryParams.append('startAt', String(params.startAt))
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/user/search?${queryParams.toString()}`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraSearchUsersParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraSearchUsersParams) => {
    const fetchUsers = async (cloudId: string) => {
      const queryParams = new URLSearchParams()
      queryParams.append('query', params!.query)
      if (params!.maxResults !== undefined)
        queryParams.append('maxResults', String(params!.maxResults))
      if (params!.startAt !== undefined) queryParams.append('startAt', String(params!.startAt))

      const usersUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/user/search?${queryParams.toString()}`

      const usersResponse = await fetch(usersUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })

      if (!usersResponse.ok) {
        let message = `Failed to search Jira users (${usersResponse.status})`
        try {
          const err = await usersResponse.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      return usersResponse.json()
    }

    let data: any

    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      data = await fetchUsers(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to search Jira users (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }
      data = await response.json()
    }

    const users = Array.isArray(data) ? data.filter(Boolean) : []

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        users: users.map((user: any) => ({
          ...(transformUser(user) ?? { accountId: '', displayName: '' }),
          self: user.self ?? null,
        })),
        total: users.length,
        startAt: params?.startAt ?? 0,
        maxResults: params?.maxResults ?? 50,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    users: {
      type: 'array',
      description: 'Array of matching Jira users',
      items: {
        type: 'object',
        properties: {
          ...USER_OUTPUT_PROPERTIES,
          self: {
            type: 'string',
            description: 'REST API URL for this user',
            optional: true,
          },
        },
      },
    },
    total: {
      type: 'number',
      description: 'Number of users returned in this page (may be less than total matches)',
    },
    startAt: { type: 'number', description: 'Pagination start index' },
    maxResults: { type: 'number', description: 'Maximum results per page' },
  },
}
