import type { JiraGetBoardSprintsParams, JiraGetBoardSprintsResponse } from '@/tools/jira/types'
import { SPRINT_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraGetBoardSprintsTool: ToolConfig<
  JiraGetBoardSprintsParams,
  JiraGetBoardSprintsResponse
> = {
  id: 'jira_get_board_sprints',
  name: 'Jira Get Board Sprints',
  description: 'Get all sprints for a Jira board',
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
    boardId: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Board ID to get sprints from',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by sprint state: active, closed, future. Comma-separated for multiple.',
    },
    startAt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first sprint to return (default: 0)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of sprints to return (default: 50)',
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
    url: (params: JiraGetBoardSprintsParams) => {
      if (params.cloudId) {
        const startAt = params.startAt ?? 0
        const maxResults = params.maxResults ?? 50
        let url = `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/agile/1.0/board/${params.boardId}/sprint?startAt=${startAt}&maxResults=${maxResults}`
        if (params.state) url += `&state=${encodeURIComponent(params.state)}`
        return url
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetBoardSprintsParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraGetBoardSprintsParams) => {
    const fetchSprints = async (cloudId: string) => {
      const startAt = params?.startAt ?? 0
      const maxResults = params?.maxResults ?? 50
      let url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0/board/${params!.boardId}/sprint?startAt=${startAt}&maxResults=${maxResults}`
      if (params?.state) url += `&state=${encodeURIComponent(params.state)}`
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })
      if (!res.ok) {
        let message = `Failed to get board sprints (${res.status})`
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
      data = await fetchSprints(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to get board sprints (${response.status})`
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
        total: data.total ?? 0,
        startAt: data.startAt ?? 0,
        maxResults: data.maxResults ?? 0,
        isLast: data.isLast ?? true,
        sprints: (data.values ?? []).map((s: any) => ({
          id: s.id ?? 0,
          name: s.name ?? '',
          state: s.state ?? '',
          startDate: s.startDate ?? null,
          endDate: s.endDate ?? null,
          completeDate: s.completeDate ?? null,
          goal: s.goal ?? null,
          boardId: s.originBoardId ?? null,
          self: s.self ?? '',
        })),
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    total: { type: 'number', description: 'Total number of sprints' },
    startAt: { type: 'number', description: 'Pagination start index' },
    maxResults: { type: 'number', description: 'Maximum results per page' },
    isLast: { type: 'boolean', description: 'Whether this is the last page' },
    sprints: {
      type: 'array',
      description: 'Array of sprints',
      items: {
        type: 'object',
        properties: SPRINT_ITEM_PROPERTIES,
      },
    },
  },
}
