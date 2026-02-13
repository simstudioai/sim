import type { JiraCreateSprintParams, JiraCreateSprintResponse } from '@/tools/jira/types'
import { SPRINT_ITEM_PROPERTIES, SUCCESS_OUTPUT, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraCreateSprintTool: ToolConfig<JiraCreateSprintParams, JiraCreateSprintResponse> = {
  id: 'jira_create_sprint',
  name: 'Jira Create Sprint',
  description: 'Create a new sprint in a Jira board',
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
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Sprint name',
    },
    boardId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Board ID to create the sprint in',
    },
    goal: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sprint goal',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sprint start date (ISO 8601 format)',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sprint end date (ISO 8601 format)',
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
    url: (params: JiraCreateSprintParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/agile/1.0/sprint`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: (params: JiraCreateSprintParams) => (params.cloudId ? 'POST' : 'GET'),
    headers: (params: JiraCreateSprintParams) => ({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
    body: (params: JiraCreateSprintParams) => {
      if (!params.cloudId) return undefined as any
      const body: Record<string, unknown> = {
        name: params.name,
        originBoardId: params.boardId,
      }
      if (params.goal) body.goal = params.goal
      if (params.startDate) body.startDate = params.startDate
      if (params.endDate) body.endDate = params.endDate
      return body
    },
  },

  transformResponse: async (response: Response, params?: JiraCreateSprintParams) => {
    const createSprint = async (cloudId: string) => {
      const body: Record<string, unknown> = {
        name: params!.name,
        originBoardId: params!.boardId,
      }
      if (params?.goal) body.goal = params.goal
      if (params?.startDate) body.startDate = params.startDate
      if (params?.endDate) body.endDate = params.endDate

      const res = await fetch(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0/sprint`,
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
        let message = `Failed to create sprint (${res.status})`
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
      data = await createSprint(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to create sprint (${response.status})`
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
