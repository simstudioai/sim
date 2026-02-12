import type { JiraUpdateSprintParams, JiraUpdateSprintResponse } from '@/tools/jira/types'
import { SPRINT_ITEM_PROPERTIES, SUCCESS_OUTPUT, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraUpdateSprintTool: ToolConfig<JiraUpdateSprintParams, JiraUpdateSprintResponse> = {
  id: 'jira_update_sprint',
  name: 'Jira Update Sprint',
  description: 'Update a sprint (name, goal, dates, state)',
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
      description: 'Sprint ID to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New sprint name',
    },
    goal: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New sprint goal',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New sprint state (active, closed, future)',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New start date (ISO 8601 format)',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New end date (ISO 8601 format)',
    },
    completeDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Completion date (ISO 8601 format, used when closing a sprint)',
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
    url: (params: JiraUpdateSprintParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/agile/1.0/sprint/${params.sprintId}`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: (params: JiraUpdateSprintParams) => (params.cloudId ? 'POST' : 'GET'),
    headers: (params: JiraUpdateSprintParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: JiraUpdateSprintParams) => {
      if (!params.cloudId) return undefined as any
      const body: Record<string, unknown> = {}
      if (params.name !== undefined) body.name = params.name
      if (params.goal !== undefined) body.goal = params.goal
      if (params.state !== undefined) body.state = params.state
      if (params.startDate !== undefined) body.startDate = params.startDate
      if (params.endDate !== undefined) body.endDate = params.endDate
      if (params.completeDate !== undefined) body.completeDate = params.completeDate
      return body
    },
  },

  transformResponse: async (response: Response, params?: JiraUpdateSprintParams) => {
    const updateSprint = async (cloudId: string) => {
      const body: Record<string, unknown> = {}
      if (params?.name !== undefined) body.name = params.name
      if (params?.goal !== undefined) body.goal = params.goal
      if (params?.state !== undefined) body.state = params.state
      if (params?.startDate !== undefined) body.startDate = params.startDate
      if (params?.endDate !== undefined) body.endDate = params.endDate
      if (params?.completeDate !== undefined) body.completeDate = params.completeDate

      const res = await fetch(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0/sprint/${params!.sprintId}`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params!.accessToken}`,
          },
          body: JSON.stringify(body),
        }
      )
      if (!res.ok) {
        let message = `Failed to update sprint (${res.status})`
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
      data = await updateSprint(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to update sprint (${response.status})`
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
        success: true,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    success: SUCCESS_OUTPUT,
    ...SPRINT_ITEM_PROPERTIES,
  },
}
