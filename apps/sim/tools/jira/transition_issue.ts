import type { JiraTransitionIssueParams, JiraTransitionIssueResponse } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig } from '@/tools/types'

export const jiraTransitionIssueTool: ToolConfig<
  JiraTransitionIssueParams,
  JiraTransitionIssueResponse
> = {
  id: 'jira_transition_issue',
  name: 'Jira Transition Issue',
  description: 'Move a Jira issue between workflow statuses (e.g., To Do -> In Progress)',
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
      description: 'Jira issue key to transition (e.g., PROJ-123)',
    },
    transitionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'ID of the transition to execute (e.g., "11" for "To Do", "21" for "In Progress")',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional comment to add when transitioning the issue',
    },
    resolution: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Resolution name to set during transition (e.g., "Fixed", "Won\'t Fix")',
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
    url: (params: JiraTransitionIssueParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}/transitions`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: (params: JiraTransitionIssueParams) => (params.cloudId ? 'POST' : 'GET'),
    headers: (params: JiraTransitionIssueParams) => {
      return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: JiraTransitionIssueParams) => {
      if (!params.cloudId) return undefined as any
      return buildTransitionBody(params)
    },
  },

  transformResponse: async (response: Response, params?: JiraTransitionIssueParams) => {
    const performTransition = async (cloudId: string) => {
      // First, fetch available transitions to get the name and target status
      const transitionsUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params!.issueKey}/transitions`
      const transitionsResp = await fetch(transitionsUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
      })

      let transitionName: string | null = null
      let toStatus: { id: string; name: string } | null = null

      if (transitionsResp.ok) {
        const transitionsData = await transitionsResp.json()
        const transition = (transitionsData?.transitions ?? []).find(
          (t: any) => String(t.id) === String(params!.transitionId)
        )
        if (transition) {
          transitionName = transition.name ?? null
          toStatus = transition.to
            ? { id: transition.to.id ?? '', name: transition.to.name ?? '' }
            : null
        }
      }

      // Perform the transition
      const transitionResponse = await fetch(transitionsUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
        body: JSON.stringify(buildTransitionBody(params!)),
      })

      if (!transitionResponse.ok) {
        let message = `Failed to transition Jira issue (${transitionResponse.status})`
        try {
          const err = await transitionResponse.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      return { transitionName, toStatus }
    }

    let transitionName: string | null = null
    let toStatus: { id: string; name: string } | null = null

    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      const result = await performTransition(cloudId)
      transitionName = result.transitionName
      toStatus = result.toStatus
    } else {
      // When cloudId was provided, the initial request was the POST transition.
      // We need to fetch transition metadata separately.
      if (!response.ok) {
        let message = `Failed to transition Jira issue (${response.status})`
        try {
          const err = await response.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      // Fetch transition metadata for the response
      try {
        const transitionsUrl = `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issue/${params.issueKey}/transitions`
        const transitionsResp = await fetch(transitionsUrl, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${params.accessToken}`,
          },
        })
        if (transitionsResp.ok) {
          const transitionsData = await transitionsResp.json()
          const transition = (transitionsData?.transitions ?? []).find(
            (t: any) => String(t.id) === String(params.transitionId)
          )
          if (transition) {
            transitionName = transition.name ?? null
            toStatus = transition.to
              ? { id: transition.to.id ?? '', name: transition.to.name ?? '' }
              : null
          }
        }
      } catch {}
    }

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueKey: params?.issueKey ?? 'unknown',
        transitionId: params?.transitionId ?? 'unknown',
        transitionName,
        toStatus,
        success: true,
      },
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    issueKey: { type: 'string', description: 'Issue key that was transitioned' },
    transitionId: { type: 'string', description: 'Applied transition ID' },
    transitionName: { type: 'string', description: 'Applied transition name', optional: true },
    toStatus: {
      type: 'object',
      description: 'Target status after transition',
      properties: {
        id: { type: 'string', description: 'Status ID' },
        name: { type: 'string', description: 'Status name' },
      },
      optional: true,
    },
  },
}

/**
 * Builds the transition request body per Jira API v3.
 */
function buildTransitionBody(params: JiraTransitionIssueParams) {
  const body: any = {
    transition: { id: params.transitionId },
  }

  if (params.resolution) {
    body.fields = {
      ...body.fields,
      resolution: { name: params.resolution },
    }
  }

  if (params.comment) {
    body.update = {
      comment: [
        {
          add: {
            body: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: params.comment }],
                },
              ],
            },
          },
        },
      ],
    }
  }

  return body
}
