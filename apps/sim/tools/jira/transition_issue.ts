import type { JiraTransitionIssueParams, JiraTransitionIssueResponse } from '@/tools/jira/types'
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
      const body: any = {
        transition: {
          id: params.transitionId,
        },
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
                      content: [
                        {
                          type: 'text',
                          text: params.comment,
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        }
      }

      return body
    },
  },

  transformResponse: async (response: Response, params?: JiraTransitionIssueParams) => {
    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      const transitionUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${params!.issueKey}/transitions`

      const body: any = {
        transition: {
          id: params!.transitionId,
        },
      }

      if (params!.comment) {
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
                      content: [
                        {
                          type: 'text',
                          text: params!.comment,
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        }
      }

      const transitionResponse = await fetch(transitionUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params!.accessToken}`,
        },
        body: JSON.stringify(body),
      })

      if (!transitionResponse.ok) {
        let message = `Failed to transition Jira issue (${transitionResponse.status})`
        try {
          const err = await transitionResponse.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      // Transition endpoint returns 204 No Content on success
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKey: params!.issueKey,
          transitionId: params!.transitionId,
          success: true,
        },
      }
    }

    if (!response.ok) {
      let message = `Failed to transition Jira issue (${response.status})`
      try {
        const err = await response.json()
        message = err?.errorMessages?.join(', ') || err?.message || message
      } catch (_e) {}
      throw new Error(message)
    }

    // Transition endpoint returns 204 No Content on success
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        issueKey: params?.issueKey || 'unknown',
        transitionId: params?.transitionId || 'unknown',
        success: true,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Operation success status',
    },
    output: {
      type: 'object',
      description:
        'Transition details with timestamp, issue key, transition ID, and success status',
    },
  },
}
