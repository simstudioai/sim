import type { JiraSearchUsersParams, JiraSearchUsersResponse } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT, USER_OUTPUT_PROPERTIES } from '@/tools/jira/types'
import { getJiraCloudId, transformUser } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraSearchUsersTool: ToolConfig<JiraSearchUsersParams, JiraSearchUsersResponse> = {
  id: 'jira_search_users',
  name: 'Jira Search Users',
  description: 'Search for users who can be assigned to issues in a project',
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
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query to filter users by name or email',
    },
    projectKey: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project key to find assignable users for (e.g., PROJ)',
    },
    startAt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first user to return (default: 0)',
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
    url: (params: JiraSearchUsersParams) => {
      if (params.cloudId) {
        const startAt = params.startAt ?? 0
        const maxResults = params.maxResults ?? 50
        if (params.projectKey) {
          let url = `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/user/assignable/search?project=${encodeURIComponent(params.projectKey.trim())}&startAt=${startAt}&maxResults=${maxResults}`
          if (params.query) url += `&query=${encodeURIComponent(params.query)}`
          return url
        }
        let url = `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/users/search?startAt=${startAt}&maxResults=${maxResults}`
        if (params.query) url += `&query=${encodeURIComponent(params.query)}`
        return url
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
      const startAt = params?.startAt ?? 0
      const maxResults = params?.maxResults ?? 50
      let url: string
      if (params?.projectKey) {
        url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/user/assignable/search?project=${encodeURIComponent(params.projectKey.trim())}&startAt=${startAt}&maxResults=${maxResults}`
        if (params.query) url += `&query=${encodeURIComponent(params.query)}`
      } else {
        url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/users/search?startAt=${startAt}&maxResults=${maxResults}`
        if (params?.query) url += `&query=${encodeURIComponent(params.query)}`
      }
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })
      if (!res.ok) {
        let message = `Failed to search users (${res.status})`
        try {
          const err = await res.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }
      return res.json()
    }

    let data: any
    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      data = await fetchUsers(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to search users (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }
      data = await response.json()
    }

    const users = Array.isArray(data) ? data : []
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        total: users.length,
        users: users
          .map((u: any) => transformUser(u))
          .filter((u): u is NonNullable<typeof u> => u !== null),
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    total: { type: 'number', description: 'Number of users returned' },
    users: {
      type: 'array',
      description: 'Array of users',
      items: {
        type: 'object',
        properties: USER_OUTPUT_PROPERTIES,
      },
    },
  },
}
