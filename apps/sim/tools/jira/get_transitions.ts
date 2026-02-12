import type { JiraGetTransitionsParams, JiraGetTransitionsResponse } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT, TRANSITION_ITEM_PROPERTIES } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraGetTransitionsTool: ToolConfig<
  JiraGetTransitionsParams,
  JiraGetTransitionsResponse
> = {
  id: 'jira_get_transitions',
  name: 'Jira Get Transitions',
  description: 'Get available transitions for a Jira issue',
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
      description: 'Jira issue key to get transitions for (e.g., PROJ-123)',
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
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}/transitions`
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
      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params!.issueKey}/transitions`
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })
      if (!res.ok) {
        let message = `Failed to get transitions (${res.status})`
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
      data = await fetchTransitions(cloudId)
    } else {
      if (!response.ok) {
        let message = `Failed to get transitions (${response.status})`
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
        issueKey: params?.issueKey ?? 'unknown',
        total: (data.transitions ?? []).length,
        transitions: (data.transitions ?? []).map((t: any) => ({
          id: t.id ?? '',
          name: t.name ?? '',
          hasScreen: t.hasScreen ?? null,
          isGlobal: t.isGlobal ?? null,
          isConditional: t.isConditional ?? null,
          to: t.to
            ? {
                id: t.to.id ?? '',
                name: t.to.name ?? '',
                description: t.to.description ?? null,
                statusCategory: t.to.statusCategory
                  ? {
                      id: t.to.statusCategory.id,
                      key: t.to.statusCategory.key ?? '',
                      name: t.to.statusCategory.name ?? '',
                      colorName: t.to.statusCategory.colorName ?? '',
                    }
                  : null,
              }
            : null,
        })),
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    issueKey: { type: 'string', description: 'Issue key' },
    total: { type: 'number', description: 'Total number of available transitions' },
    transitions: {
      type: 'array',
      description: 'Array of available transitions',
      items: {
        type: 'object',
        properties: TRANSITION_ITEM_PROPERTIES,
      },
    },
  },
}
