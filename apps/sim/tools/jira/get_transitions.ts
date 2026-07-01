import type { JiraGetTransitionsParams, JiraGetTransitionsResponse } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId, parseAtlassianErrorMessage } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

function buildTransitionsUrl(cloudId: string, issueKey: string): string {
  return `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`
}

export const jiraGetTransitionsTool: ToolConfig<
  JiraGetTransitionsParams,
  JiraGetTransitionsResponse
> = {
  id: 'jira_get_transitions',
  name: 'Jira Get Transitions',
  description:
    'Get the workflow transitions available for an issue in its current status. Use the returned transition IDs with the Transition Issue operation.',
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
    issueKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The issue key or ID (e.g., PROJ-123)',
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
    url: (params: JiraGetTransitionsParams) => {
      if (params.cloudId) {
        return buildTransitionsUrl(params.cloudId, params.issueKey)
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'GET',
    headers: (params: JiraGetTransitionsParams) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response, params?: JiraGetTransitionsParams) => {
    const fetchTransitions = async (cloudId: string) => {
      const transitionsResponse = await fetch(buildTransitionsUrl(cloudId, params!.issueKey), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })

      if (!transitionsResponse.ok) {
        const errorText = await transitionsResponse.text()
        throw new Error(
          parseAtlassianErrorMessage(
            transitionsResponse.status,
            transitionsResponse.statusText,
            errorText
          )
        )
      }

      return transitionsResponse.json()
    }

    let data: any

    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      data = await fetchTransitions(cloudId)
    } else {
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(parseAtlassianErrorMessage(response.status, response.statusText, errorText))
      }
      data = await response.json()
    }

    const transitions = Array.isArray(data?.transitions) ? data.transitions : []

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueKey: params?.issueKey ?? '',
        transitions: transitions.map((t: any) => ({
          id: t?.id ?? '',
          name: t?.name ?? '',
          toStatusId: t?.to?.id ?? null,
          toStatusName: t?.to?.name ?? null,
          toStatusCategory: t?.to?.statusCategory?.key ?? null,
          isAvailable: t?.isAvailable ?? null,
          hasScreen: t?.hasScreen ?? null,
        })),
        total: transitions.length,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    issueKey: { type: 'string', description: 'Issue key the transitions belong to' },
    transitions: {
      type: 'array',
      description: 'Available workflow transitions for the issue',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Transition ID (use with Transition Issue)' },
          name: { type: 'string', description: 'Transition name (e.g., "Start Progress")' },
          toStatusId: {
            type: 'string',
            description: 'ID of the status the issue moves to',
            optional: true,
          },
          toStatusName: {
            type: 'string',
            description: 'Name of the status the issue moves to',
            optional: true,
          },
          toStatusCategory: {
            type: 'string',
            description: 'Status category key of the target status (new, indeterminate, done)',
            optional: true,
          },
          isAvailable: {
            type: 'boolean',
            description: 'Whether the transition can currently be performed',
            optional: true,
          },
          hasScreen: {
            type: 'boolean',
            description: 'Whether the transition requires a screen with fields',
            optional: true,
          },
        },
      },
    },
    total: { type: 'number', description: 'Number of available transitions' },
  },
}
