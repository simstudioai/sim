import type { JiraDeleteComponentParams, JiraDeleteComponentResponse } from '@/tools/jira/types'
import { SUCCESS_OUTPUT, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraDeleteComponentTool: ToolConfig<
  JiraDeleteComponentParams,
  JiraDeleteComponentResponse
> = {
  id: 'jira_delete_component',
  name: 'Jira Delete Component',
  description: 'Delete a component from a Jira project',
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
    componentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Component ID to delete',
    },
    moveIssuesTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Component ID to reassign issues to (optional)',
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
    url: (params: JiraDeleteComponentParams) => {
      if (params.cloudId) {
        let url = `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/component/${params.componentId.trim()}`
        if (params.moveIssuesTo)
          url += `?moveIssuesTo=${encodeURIComponent(params.moveIssuesTo.trim())}`
        return url
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: (params: JiraDeleteComponentParams) => (params.cloudId ? 'DELETE' : 'GET'),
    headers: (params: JiraDeleteComponentParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraDeleteComponentParams) => {
    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      let url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/component/${params!.componentId.trim()}`
      if (params?.moveIssuesTo)
        url += `?moveIssuesTo=${encodeURIComponent(params.moveIssuesTo.trim())}`
      const deleteResponse = await fetch(url, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })

      if (deleteResponse.status !== 204 && !deleteResponse.ok) {
        let message = `Failed to delete component (${deleteResponse.status})`
        try {
          const err = await deleteResponse.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          componentId: params!.componentId,
          success: true,
        },
      }
    }

    if (response.status !== 204 && !response.ok) {
      let message = `Failed to delete component (${response.status})`
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
        componentId: params?.componentId ?? 'unknown',
        success: true,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    success: SUCCESS_OUTPUT,
    componentId: { type: 'string', description: 'Deleted component ID' },
  },
}
