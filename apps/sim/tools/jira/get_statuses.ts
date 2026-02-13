import type { JiraGetStatusesParams, JiraGetStatusesResponse } from '@/tools/jira/types'
import { STATUS_OUTPUT_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraGetStatusesTool: ToolConfig<JiraGetStatusesParams, JiraGetStatusesResponse> = {
  id: 'jira_get_statuses',
  name: 'Jira Get Statuses',
  description: 'Get all statuses available in the Jira instance or for a specific project',
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
    projectId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter statuses by project ID (optional)',
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
    url: (params: JiraGetStatusesParams) => {
      if (params.cloudId) {
        if (params.projectId) {
          return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/project/${encodeURIComponent(params.projectId.trim())}/statuses`
        }
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/status`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetStatusesParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraGetStatusesParams) => {
    const fetchStatuses = async (cloudId: string) => {
      let url: string
      if (params?.projectId) {
        url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/${encodeURIComponent(params.projectId.trim())}/statuses`
      } else {
        url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/status`
      }
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })
      if (!res.ok) {
        let message = `Failed to get statuses (${res.status})`
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
      data = await fetchStatuses(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to get statuses (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }
      data = await response.json()
    }

    let statuses: any[] = []
    if (params?.projectId && Array.isArray(data)) {
      for (const issueType of data) {
        for (const status of issueType.statuses ?? []) {
          if (!statuses.find((s: any) => s.id === status.id)) {
            statuses.push(status)
          }
        }
      }
    } else if (Array.isArray(data)) {
      statuses = data
    }

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        total: statuses.length,
        statuses: statuses.map((s: any) => ({
          id: s.id ?? '',
          name: s.name ?? '',
          description: s.description ?? null,
          statusCategory: s.statusCategory
            ? {
                id: s.statusCategory.id,
                key: s.statusCategory.key ?? '',
                name: s.statusCategory.name ?? '',
                colorName: s.statusCategory.colorName ?? '',
              }
            : null,
        })),
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    total: { type: 'number', description: 'Total number of statuses' },
    statuses: {
      type: 'array',
      description: 'Array of statuses',
      items: {
        type: 'object',
        properties: STATUS_OUTPUT_PROPERTIES,
      },
    },
  },
}
