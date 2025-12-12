import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface JiraAddWatcherParams {
  accessToken: string
  domain: string
  issueKey: string
  accountId: string
  cloudId?: string
}

export interface JiraAddWatcherResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    watcherAccountId: string
    success: boolean
  }
}

export const jiraAddWatcherTool: ToolConfig<JiraAddWatcherParams, JiraAddWatcherResponse> = {
  id: 'jira_add_watcher',
  name: 'Jira Add Watcher',
  description: 'Add a watcher to a Jira issue to receive notifications about updates',
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
    issueKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Jira issue key to add watcher to (e.g., PROJ-123)',
    },
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Account ID of the user to add as watcher',
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
    url: (params: JiraAddWatcherParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}/watchers`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: (params: JiraAddWatcherParams) => (params.cloudId ? 'POST' : 'GET'),
    headers: (params: JiraAddWatcherParams) => {
      return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: JiraAddWatcherParams) => {
      if (!params.cloudId) return undefined as any
      return params.accountId as any
    },
  },

  transformResponse: async (response: Response, params?: JiraAddWatcherParams) => {
    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      // Make the actual request with the resolved cloudId
      const watcherUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params?.issueKey}/watchers`
      const watcherResponse = await fetch(watcherUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params?.accessToken}`,
        },
        body: JSON.stringify(params?.accountId),
      })

      if (!watcherResponse.ok) {
        let message = `Failed to add watcher to Jira issue (${watcherResponse.status})`
        try {
          const err = await watcherResponse.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKey: params?.issueKey || 'unknown',
          watcherAccountId: params?.accountId || 'unknown',
          success: true,
        },
      }
    }

    // If cloudId was provided, process the response
    if (!response.ok) {
      let message = `Failed to add watcher to Jira issue (${response.status})`
      try {
        const err = await response.json()
        message = err?.errorMessages?.join(', ') || err?.message || message
      } catch (_e) {}
      throw new Error(message)
    }

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueKey: params?.issueKey || 'unknown',
        watcherAccountId: params?.accountId || 'unknown',
        success: true,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Operation success status',
    },
    output: {
      type: 'object',
      description:
        'Watcher details with timestamp, issue key, watcher account ID, and success status',
    },
  },
}
