import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface JiraCreateIssueLinkParams {
  accessToken: string
  domain: string
  inwardIssueKey: string
  outwardIssueKey: string
  linkType: string
  comment?: string
  cloudId?: string
}

export interface JiraCreateIssueLinkResponse extends ToolResponse {
  output: {
    ts: string
    inwardIssue: string
    outwardIssue: string
    linkType: string
    success: boolean
  }
}

export const jiraCreateIssueLinkTool: ToolConfig<
  JiraCreateIssueLinkParams,
  JiraCreateIssueLinkResponse
> = {
  id: 'jira_create_issue_link',
  name: 'Jira Create Issue Link',
  description: 'Create a link relationship between two Jira issues',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
    additionalScopes: ['write:issue-link:jira', 'read:jira-work'],
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
    inwardIssueKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Jira issue key for the inward issue (e.g., PROJ-123)',
    },
    outwardIssueKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Jira issue key for the outward issue (e.g., PROJ-456)',
    },
    linkType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The type of link relationship (e.g., "Blocks", "Relates to", "Duplicates")',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional comment to add to the issue link',
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
    url: (params: JiraCreateIssueLinkParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issueLink`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: 'POST',
    headers: (params: JiraCreateIssueLinkParams) => {
      return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: JiraCreateIssueLinkParams) => {
      return {
        type: {
          name: params?.linkType,
        },
        inwardIssue: {
          key: params?.inwardIssueKey,
        },
        outwardIssue: {
          key: params?.outwardIssueKey,
        },
        comment: params?.comment
          ? {
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
            }
          : undefined,
      }
    },
  },

  transformResponse: async (response: Response, params?: JiraCreateIssueLinkParams) => {
    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      // Make the actual request with the resolved cloudId
      const linkUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issueLink`
      const linkResponse = await fetch(linkUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params?.accessToken}`,
        },
        body: JSON.stringify({
          type: {
            name: params?.linkType,
          },
          inwardIssue: {
            key: params?.inwardIssueKey,
          },
          outwardIssue: {
            key: params?.outwardIssueKey,
          },
          comment: params?.comment
            ? {
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
              }
            : undefined,
        }),
      })

      if (!linkResponse.ok) {
        let message = `Failed to create issue link (${linkResponse.status})`
        try {
          const err = await linkResponse.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          inwardIssue: params?.inwardIssueKey || 'unknown',
          outwardIssue: params?.outwardIssueKey || 'unknown',
          linkType: params?.linkType || 'unknown',
          success: true,
        },
      }
    }

    // If cloudId was provided, process the response
    if (!response.ok) {
      let message = `Failed to create issue link (${response.status})`
      try {
        const err = await response.json()
        message = err?.errorMessages?.join(', ') || err?.message || message
      } catch (_e) {}
      throw new Error(message)
    }

    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        inwardIssue: params?.inwardIssueKey || 'unknown',
        outwardIssue: params?.outwardIssueKey || 'unknown',
        linkType: params?.linkType || 'unknown',
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
        'Issue link details with timestamp, inward issue key, outward issue key, link type, and success status',
    },
  },
}
