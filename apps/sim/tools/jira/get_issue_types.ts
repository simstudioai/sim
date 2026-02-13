import type { JiraGetIssueTypesParams, JiraGetIssueTypesResponse } from '@/tools/jira/types'
import { ISSUE_TYPE_OUTPUT_PROPERTIES, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraGetIssueTypesTool: ToolConfig<JiraGetIssueTypesParams, JiraGetIssueTypesResponse> =
  {
    id: 'jira_get_issue_types',
    name: 'Jira Get Issue Types',
    description: 'Get all issue types available in the Jira instance or for a specific project',
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
        description: 'Filter issue types by project ID (optional)',
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
      url: (params: JiraGetIssueTypesParams) => {
        if (params.cloudId) {
          if (params.projectId) {
            return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issuetype/project?projectId=${encodeURIComponent(params.projectId.trim())}`
          }
          return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issuetype`
        }
        return 'https://api.atlassian.com/oauth/token/accessible-resources'
      },
      method: 'GET',
      headers: (params: JiraGetIssueTypesParams) => ({
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }),
    },

    transformResponse: async (response: Response, params?: JiraGetIssueTypesParams) => {
      const fetchIssueTypes = async (cloudId: string) => {
        let url: string
        if (params?.projectId) {
          url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issuetype/project?projectId=${encodeURIComponent(params.projectId.trim())}`
        } else {
          url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issuetype`
        }
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${params!.accessToken}`,
          },
        })
        if (!res.ok) {
          let message = `Failed to get issue types (${res.status})`
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
        data = await fetchIssueTypes(cloudId)
      } else {
        if (!response.ok) {
          let message = `Failed to get issue types (${response.status})`
          try {
            const err = await response.json()
            message = err?.errorMessages?.join(', ') || err?.message || message
          } catch (_e) {}
          throw new Error(message)
        }
        data = await response.json()
      }

      const issueTypes = Array.isArray(data) ? data : []
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          total: issueTypes.length,
          issueTypes: issueTypes.map((t: any) => ({
            id: t.id ?? '',
            name: t.name ?? '',
            description: t.description ?? null,
            subtask: t.subtask ?? false,
            iconUrl: t.iconUrl ?? null,
          })),
        },
      }
    },

    outputs: {
      ts: TIMESTAMP_OUTPUT,
      total: { type: 'number', description: 'Total number of issue types' },
      issueTypes: {
        type: 'array',
        description: 'Array of issue types',
        items: {
          type: 'object',
          properties: ISSUE_TYPE_OUTPUT_PROPERTIES,
        },
      },
    },
  }
