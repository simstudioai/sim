import type { JiraGetUsersParams, JiraGetUsersResponse } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT, USER_OUTPUT_PROPERTIES } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Transforms a raw Jira user API object into typed output.
 */
function transformUserOutput(user: any) {
  return {
    accountId: user.accountId ?? '',
    accountType: user.accountType ?? null,
    active: user.active ?? false,
    displayName: user.displayName ?? '',
    emailAddress: user.emailAddress ?? null,
    avatarUrl: user.avatarUrls?.['48x48'] ?? null,
    avatarUrls: user.avatarUrls ?? null,
    timeZone: user.timeZone ?? null,
    self: user.self ?? null,
  }
}

export const jiraGetUsersTool: ToolConfig<JiraGetUsersParams, JiraGetUsersResponse> = {
  id: 'jira_get_users',
  name: 'Jira Get Users',
  description:
    'Get Jira users. If an account ID is provided, returns a single user. Otherwise, returns a list of all users.',
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
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional account ID to get a specific user. If not provided, returns all users.',
    },
    startAt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The index of the first user to return (for pagination, default: 0)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of users to return (default: 50)',
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
    url: (params: JiraGetUsersParams) => {
      if (params.cloudId) {
        if (params.accountId) {
          return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/user?accountId=${encodeURIComponent(params.accountId)}`
        }
        const queryParams = new URLSearchParams()
        if (params.startAt !== undefined) queryParams.append('startAt', String(params.startAt))
        if (params.maxResults !== undefined)
          queryParams.append('maxResults', String(params.maxResults))
        const queryString = queryParams.toString()
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/users/search${queryString ? `?${queryString}` : ''}`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetUsersParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraGetUsersParams) => {
    const fetchUsers = async (cloudId: string) => {
      let usersUrl: string
      if (params!.accountId) {
        usersUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/user?accountId=${encodeURIComponent(params!.accountId)}`
      } else {
        const queryParams = new URLSearchParams()
        if (params!.startAt !== undefined) queryParams.append('startAt', String(params!.startAt))
        if (params!.maxResults !== undefined)
          queryParams.append('maxResults', String(params!.maxResults))
        const queryString = queryParams.toString()
        usersUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/users/search${queryString ? `?${queryString}` : ''}`
      }

      const usersResponse = await fetch(usersUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })

      if (!usersResponse.ok) {
        let message = `Failed to get Jira users (${usersResponse.status})`
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
        let message = `Failed to get Jira users (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }
      data = await response.json()
    }

    const users = params?.accountId ? [data] : data

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        users: users.map(transformUserOutput),
        total: params?.accountId ? 1 : users.length,
        startAt: params?.startAt ?? 0,
        maxResults: params?.maxResults ?? 50,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    users: {
      type: 'array',
      description: 'Array of Jira users',
      items: {
        type: 'object',
        properties: {
          ...USER_OUTPUT_PROPERTIES,
          avatarUrls: {
            type: 'json',
            description: 'User avatar URLs in multiple sizes (16x16, 24x24, 32x32, 48x48)',
            optional: true,
          },
          self: {
            type: 'string',
            description: 'REST API URL for this user',
            optional: true,
          },
        },
      },
    },
    total: { type: 'number', description: 'Total number of users returned' },
    startAt: { type: 'number', description: 'Pagination start index' },
    maxResults: { type: 'number', description: 'Maximum results per page' },
  },
}
