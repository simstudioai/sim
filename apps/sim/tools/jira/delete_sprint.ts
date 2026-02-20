import type { JiraDeleteSprintParams, JiraDeleteSprintResponse } from '@/tools/jira/types'
import { SUCCESS_OUTPUT, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraDeleteSprintTool: ToolConfig<JiraDeleteSprintParams, JiraDeleteSprintResponse> = {
  id: 'jira_delete_sprint',
  name: 'Jira Delete Sprint',
  description: 'Delete a sprint from a Jira board',
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
    sprintId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Sprint ID to delete',
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
    url: (params: JiraDeleteSprintParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/agile/1.0/sprint/${params.sprintId}`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: (params: JiraDeleteSprintParams) => (params.cloudId ? 'DELETE' : 'GET'),
    headers: (params: JiraDeleteSprintParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraDeleteSprintParams) => {
    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      const deleteResponse = await fetch(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0/sprint/${params!.sprintId}`,
        {
          method: 'DELETE',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${params!.accessToken}`,
          },
        }
      )

      if (deleteResponse.status !== 204 && !deleteResponse.ok) {
        let message = `Failed to delete sprint (${deleteResponse.status})`
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
          sprintId: params!.sprintId,
          success: true,
        },
      }
    }

    if (response.status !== 204 && !response.ok) {
      let message = `Failed to delete sprint (${response.status})`
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
        sprintId: params?.sprintId ?? 0,
        success: true,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    success: SUCCESS_OUTPUT,
    sprintId: { type: 'number', description: 'Deleted sprint ID' },
  },
}
