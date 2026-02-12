import type { JiraGetMyselfParams, JiraGetMyselfResponse } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT, USER_OUTPUT_PROPERTIES } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraGetMyselfTool: ToolConfig<JiraGetMyselfParams, JiraGetMyselfResponse> = {
  id: 'jira_get_myself',
  name: 'Jira Get Current User',
  description: 'Get details of the currently authenticated Jira user',
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
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Jira Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: (params: JiraGetMyselfParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/myself`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetMyselfParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraGetMyselfParams) => {
    const fetchMyself = async (cloudId: string) => {
      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })
      if (!res.ok) {
        let message = `Failed to get current user (${res.status})`
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
      data = await fetchMyself(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to get current user (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }
      data = await response.json()
    }

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        accountId: data.accountId ?? '',
        displayName: data.displayName ?? '',
        active: data.active ?? null,
        emailAddress: data.emailAddress ?? null,
        avatarUrl: data.avatarUrls?.['48x48'] ?? null,
        accountType: data.accountType ?? null,
        timeZone: data.timeZone ?? null,
        locale: data.locale ?? null,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    ...USER_OUTPUT_PROPERTIES,
    locale: { type: 'string', description: 'User locale (e.g., en_US)', optional: true },
  },
}
