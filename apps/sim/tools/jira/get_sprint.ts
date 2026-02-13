import type { JiraGetSprintParams, JiraGetSprintResponse } from '@/tools/jira/types'
import { SPRINT_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraGetSprintTool: ToolConfig<JiraGetSprintParams, JiraGetSprintResponse> = {
  id: 'jira_get_sprint',
  name: 'Jira Get Sprint',
  description: 'Get details of a specific sprint',
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
      description: 'Sprint ID',
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
    url: (params: JiraGetSprintParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/agile/1.0/sprint/${params.sprintId}`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetSprintParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraGetSprintParams) => {
    const fetchSprint = async (cloudId: string) => {
      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0/sprint/${params!.sprintId}`
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })
      if (!res.ok) {
        let message = `Failed to get sprint (${res.status})`
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
      data = await fetchSprint(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to get sprint (${response.status})`
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
        id: data.id ?? 0,
        name: data.name ?? '',
        state: data.state ?? '',
        startDate: data.startDate ?? null,
        endDate: data.endDate ?? null,
        completeDate: data.completeDate ?? null,
        goal: data.goal ?? null,
        boardId: data.originBoardId ?? null,
        self: data.self ?? '',
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    ...SPRINT_ITEM_PROPERTIES,
  },
}
