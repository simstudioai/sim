import type { JiraGetLabelsParams, JiraGetLabelsResponse } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraGetLabelsTool: ToolConfig<JiraGetLabelsParams, JiraGetLabelsResponse> = {
  id: 'jira_get_labels',
  name: 'Jira Get Labels',
  description: 'Get all labels used across the Jira instance',
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
    startAt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Index of the first label to return (default: 0)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of labels to return (default: 1000)',
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
    url: (params: JiraGetLabelsParams) => {
      if (params.cloudId) {
        const startAt = params.startAt ?? 0
        const maxResults = params.maxResults ?? 1000
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/label?startAt=${startAt}&maxResults=${maxResults}`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetLabelsParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraGetLabelsParams) => {
    const fetchLabels = async (cloudId: string) => {
      const startAt = params?.startAt ?? 0
      const maxResults = params?.maxResults ?? 1000
      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/label?startAt=${startAt}&maxResults=${maxResults}`
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })
      if (!res.ok) {
        let message = `Failed to get labels (${res.status})`
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
      data = await fetchLabels(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to get labels (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }
      data = await response.json()
    }

    const labels: string[] = data.values ?? []
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        total: data.total ?? labels.length,
        maxResults: data.maxResults ?? 0,
        isLast: data.isLast ?? true,
        labels,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    total: { type: 'number', description: 'Total number of labels' },
    maxResults: { type: 'number', description: 'Maximum results per page' },
    isLast: { type: 'boolean', description: 'Whether this is the last page' },
    labels: {
      type: 'array',
      description: 'Array of label names',
      items: { type: 'string' },
    },
  },
}
