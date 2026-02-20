import type { JiraListBoardsParams, JiraListBoardsResponse } from '@/tools/jira/types'
import { BOARD_ITEM_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraListBoardsTool: ToolConfig<JiraListBoardsParams, JiraListBoardsResponse> = {
  id: 'jira_list_boards',
  name: 'Jira List Boards',
  description: 'List all boards in Jira (scrum, kanban, simple)',
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
    projectKeyOrId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter boards by project key or ID',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by board type: scrum, kanban, or simple',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter boards by name (supports partial match)',
    },
    startAt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first board to return (default: 0)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of boards to return (default: 50)',
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
    url: (params: JiraListBoardsParams) => {
      if (params.cloudId) {
        const startAt = params.startAt ?? 0
        const maxResults = params.maxResults ?? 50
        let url = `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/agile/1.0/board?startAt=${startAt}&maxResults=${maxResults}`
        if (params.projectKeyOrId)
          url += `&projectKeyOrId=${encodeURIComponent(params.projectKeyOrId.trim())}`
        if (params.type) url += `&type=${encodeURIComponent(params.type)}`
        if (params.name) url += `&name=${encodeURIComponent(params.name)}`
        return url
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraListBoardsParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraListBoardsParams) => {
    const fetchBoards = async (cloudId: string) => {
      const startAt = params?.startAt ?? 0
      const maxResults = params?.maxResults ?? 50
      let url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/agile/1.0/board?startAt=${startAt}&maxResults=${maxResults}`
      if (params?.projectKeyOrId)
        url += `&projectKeyOrId=${encodeURIComponent(params.projectKeyOrId.trim())}`
      if (params?.type) url += `&type=${encodeURIComponent(params.type)}`
      if (params?.name) url += `&name=${encodeURIComponent(params.name)}`
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })
      if (!res.ok) {
        let message = `Failed to list Jira boards (${res.status})`
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
      data = await fetchBoards(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to list Jira boards (${response.status})`
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
        boards: (data.values ?? []).map((b: any) => ({
          id: b.id ?? 0,
          name: b.name ?? '',
          type: b.type ?? '',
          self: b.self ?? '',
        })),
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    total: { type: 'number', description: 'Total number of boards' },
    startAt: { type: 'number', description: 'Pagination start index' },
    maxResults: { type: 'number', description: 'Maximum results per page' },
    isLast: { type: 'boolean', description: 'Whether this is the last page' },
    boards: {
      type: 'array',
      description: 'Array of boards',
      items: {
        type: 'object',
        properties: BOARD_ITEM_PROPERTIES,
      },
    },
  },
}
