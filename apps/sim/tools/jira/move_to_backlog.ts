import type { JiraMoveToBacklogParams, JiraMoveToBacklogResponse } from '@/tools/jira/types'
import { SUCCESS_OUTPUT, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraMoveToBacklogTool: ToolConfig<JiraMoveToBacklogParams, JiraMoveToBacklogResponse> =
  {
    id: 'jira_move_to_backlog',
    name: 'Jira Move to Backlog',
    description: 'Move one or more issues to the backlog',
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
      issueKeys: {
        type: 'json',
        required: true,
        visibility: 'user-or-llm',
        description: 'Array of issue keys to move to backlog (e.g., ["PROJ-1", "PROJ-2"])',
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
      url: (params: JiraMoveToBacklogParams) => {
        if (params.cloudId) {
          return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/agile/1.0/backlog/issue`
        }
        return 'https://api.atlassian.com/oauth/token/accessible-resources'
      },
      method: (params: JiraMoveToBacklogParams) => (params.cloudId ? 'POST' : 'GET'),
      headers: (params: JiraMoveToBacklogParams) => ({
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }),
      body: (params: JiraMoveToBacklogParams) => {
        if (!params.cloudId) return undefined as any
        const keys = Array.isArray(params.issueKeys) ? params.issueKeys : [params.issueKeys]
        return { issues: keys }
      },
    },

    transformResponse: async (response: Response, params?: JiraMoveToBacklogParams) => {
      const moveToBacklog = async (cloudId: string) => {
        const keys = Array.isArray(params!.issueKeys) ? params!.issueKeys : [params!.issueKeys]
        const res = await fetch(
          `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0/backlog/issue`,
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Bearer ${params!.accessToken}`,
            },
            body: JSON.stringify({ issues: keys }),
          }
        )
        if (!res.ok) {
          let message = `Failed to move issues to backlog (${res.status})`
          try {
            const err = await res.json()
            message = err?.errorMessages?.join(', ') || err?.message || message
          } catch (_e) {}
          throw new Error(message)
        }
      }

      if (!params?.cloudId) {
        const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
        await moveToBacklog(cloudId)
      } else {
        if (!response.ok) {
          let message = `Failed to move issues to backlog (${response.status})`
          try {
            const err = await response.json()
            message = err?.errorMessages?.join(', ') || err?.message || message
          } catch (_e) {}
          throw new Error(message)
        }
      }

      const keys = Array.isArray(params!.issueKeys) ? params!.issueKeys : [params!.issueKeys]
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKeys: keys,
          issueCount: keys.length,
          success: true,
        },
      }
    },

    outputs: {
      ts: TIMESTAMP_OUTPUT,
      success: SUCCESS_OUTPUT,
      issueKeys: {
        type: 'array',
        description: 'Issue keys that were moved to backlog',
        items: { type: 'string' },
      },
      issueCount: { type: 'number', description: 'Number of issues moved' },
    },
  }
