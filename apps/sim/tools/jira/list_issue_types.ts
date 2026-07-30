import type { JiraListIssueTypesParams, JiraListIssueTypesResponse } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId, parseAtlassianErrorMessage } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

function buildIssueTypesUrl(cloudId: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issuetype`
}

export const jiraListIssueTypesTool: ToolConfig<
  JiraListIssueTypesParams,
  JiraListIssueTypesResponse
> = {
  id: 'jira_list_issue_types',
  name: 'Jira List Issue Types',
  description:
    'List all issue types visible to the user across projects (e.g., Task, Bug, Story, Epic, Subtask). Useful for discovering valid issue types before creating an issue.',
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
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Jira Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: (params: JiraListIssueTypesParams) => {
      if (params.cloudId) {
        return buildIssueTypesUrl(params.cloudId)
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraListIssueTypesParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraListIssueTypesParams) => {
    const fetchIssueTypes = async (cloudId: string) => {
      const issueTypesResponse = await fetch(buildIssueTypesUrl(cloudId), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })

      if (!issueTypesResponse.ok) {
        const errorText = await issueTypesResponse.text()
        throw new Error(
          parseAtlassianErrorMessage(
            issueTypesResponse.status,
            issueTypesResponse.statusText,
            errorText
          )
        )
      }

      return issueTypesResponse.json()
    }

    let data: any

    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      data = await fetchIssueTypes(cloudId)
    } else {
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(parseAtlassianErrorMessage(response.status, response.statusText, errorText))
      }
      data = await response.json()
    }

    const issueTypes = Array.isArray(data) ? data : []

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueTypes: issueTypes.map((t: any) => ({
          id: t?.id ?? '',
          name: t?.name ?? '',
          description: t?.description ?? null,
          subtask: t?.subtask ?? null,
          hierarchyLevel: typeof t?.hierarchyLevel === 'number' ? t.hierarchyLevel : null,
          iconUrl: t?.iconUrl ?? null,
          scope: t?.scope?.project?.id ?? null,
        })),
        total: issueTypes.length,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    issueTypes: {
      type: 'array',
      description: 'Array of issue types',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Issue type ID' },
          name: { type: 'string', description: 'Issue type name (e.g., Task, Bug, Story)' },
          description: { type: 'string', description: 'Issue type description', optional: true },
          subtask: {
            type: 'boolean',
            description: 'Whether this issue type is a subtask',
            optional: true,
          },
          hierarchyLevel: {
            type: 'number',
            description: 'Hierarchy level (0 = standard, 1 = epic, -1 = subtask)',
            optional: true,
          },
          iconUrl: { type: 'string', description: 'URL of the issue type icon', optional: true },
          scope: {
            type: 'string',
            description: 'Project ID if this issue type is scoped to a team-managed project',
            optional: true,
          },
        },
      },
    },
    total: { type: 'number', description: 'Number of issue types returned' },
  },
}
