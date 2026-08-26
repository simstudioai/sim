import type { JiraRemoveWatcherParams, JiraRemoveWatcherResponse } from '@/tools/jira/types'
import { SUCCESS_OUTPUT, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * Builds the watchers URL for both call sites — `request.url` and the
 * `transformResponse` rebuild — so the two cannot drift.
 *
 * `accountId` is `required: true`, but the previous
 * `encodeURIComponent(params.accountId?.trim() ?? '')` turned an absent value
 * into `?accountId=`, sending a DELETE that names no watcher instead of
 * reporting the missing parameter. It now fails by name, matching the message
 * shape the path guards in `@/tools/url-path` use.
 */
function buildWatcherUrl(cloudId: string, params: JiraRemoveWatcherParams): string {
  const accountId = params.accountId?.trim()
  if (!accountId) {
    throw new Error('accountId is required')
  }

  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${safeUrlPathSegment(params.issueKey ?? '', 'issueKey')}/watchers?accountId=${encodeURIComponent(accountId)}`
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
          return buildWatcherUrl(params.cloudId, params)
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
        const watcherUrl = buildWatcherUrl(cloudId, params!)
        const watcherResponse = await fetch(watcherUrl, {
          method: 'DELETE',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${params!.accessToken}`,
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
            issueKey: params!.issueKey || 'unknown',
            watcherAccountId: params!.accountId || 'unknown',
            success: true,
          },
        }
      }

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
          issueKey: params!.issueKey || 'unknown',
          watcherAccountId: params!.accountId || 'unknown',
          success: true,
        },
      }
    },

    outputs: {
      ts: TIMESTAMP_OUTPUT,
      success: SUCCESS_OUTPUT,
      issueKey: { type: 'string', description: 'Issue key' },
      watcherAccountId: { type: 'string', description: 'Removed watcher account ID' },
    },
  }
