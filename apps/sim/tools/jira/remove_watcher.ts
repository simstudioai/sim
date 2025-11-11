import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface JiraRemoveWatcherParams {
  accessToken: string
  domain: string
  issueKey: string
  accountId: string
  cloudId?: string
}

export interface JiraRemoveWatcherResponse extends ToolResponse {
  output: {
    ts: string
    issueKey: string
    watcherAccountId: string
    success: boolean
  }
}

export const jiraRemoveWatcherTool: ToolConfig<JiraRemoveWatcherParams, JiraRemoveWatcherResponse> =
  {
    id: 'jira_remove_watcher',
    name: 'Jira Remove Watcher',
    description: 'Remove a watcher from a Jira issue',
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
        description: 'Jira issue key to remove watcher from (e.g., PROJ-123)',
      },
      accountId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Account ID of the user to remove as watcher',
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
      url: (params: JiraRemoveWatcherParams) => {
        if (params.cloudId) {
          return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}/watchers?accountId=${params.accountId}`
        }
        return 'https://api.atlassian.com/oauth/token/accessible-resources'
      },
      method: (params: JiraRemoveWatcherParams) => (params.cloudId ? 'DELETE' : 'GET'),
      headers: (params: JiraRemoveWatcherParams) => {
        return {
          Accept: 'application/json',
          Authorization: `Bearer ${params.accessToken}`,
        }
      },
    },

    transformResponse: async (response: Response, params?: JiraRemoveWatcherParams) => {
      if (!params?.cloudId) {
        const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
        // Make the actual request with the resolved cloudId
        const watcherUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params?.issueKey}/watchers?accountId=${params?.accountId}`
        const watcherResponse = await fetch(watcherUrl, {
          method: 'DELETE',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${params?.accessToken}`,
          },
        })

        if (!watcherResponse.ok) {
          let message = `Failed to remove watcher from Jira issue (${watcherResponse.status})`
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
        let message = `Failed to remove watcher from Jira issue (${response.status})`
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
          'Removal details with timestamp, issue key, watcher account ID, and success status',
      },
    },
  }
