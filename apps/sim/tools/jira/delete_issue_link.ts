import { getJiraCloudId } from '@/tools/jira/utils'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface JiraDeleteIssueLinkParams {
  accessToken: string
  domain: string
  linkId: string
  cloudId?: string
}

export interface JiraDeleteIssueLinkResponse extends ToolResponse {
  output: {
    ts: string
    linkId: string
    success: boolean
  }
}

export const jiraDeleteIssueLinkTool: ToolConfig<
  JiraDeleteIssueLinkParams,
  JiraDeleteIssueLinkResponse
> = {
  id: 'jira_delete_issue_link',
  name: 'Jira Delete Issue Link',
  description: 'Delete a link between two Jira issues',
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
    linkId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the issue link to delete',
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
    url: (params: JiraDeleteIssueLinkParams) => {
      if (params.cloudId) {
        return `https://api.atlassian.com/ex/jira/${params.cloudId}/rest/api/3/issueLink/${params.linkId}`
      }
      return 'https://api.atlassian.com/oauth/token/accessible-resources'
    },
    method: (params: JiraDeleteIssueLinkParams) => (params.cloudId ? 'DELETE' : 'GET'),
    headers: (params: JiraDeleteIssueLinkParams) => {
      return {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response, params?: JiraDeleteIssueLinkParams) => {
    if (!params?.cloudId) {
      const cloudId = await getJiraCloudId(params!.domain, params!.accessToken)
      // Make the actual request with the resolved cloudId
      const issueLinkUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issueLink/${params?.linkId}`
      const issueLinkResponse = await fetch(issueLinkUrl, {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${params?.accessToken}`,
        },
      })

      if (!issueLinkResponse.ok) {
        let message = `Failed to delete issue link (${issueLinkResponse.status})`
        try {
          const err = await issueLinkResponse.json()
          message = err?.errorMessages?.join(', ') || err?.message || message
        } catch (_e) {}
        throw new Error(message)
      }

      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          linkId: params?.linkId || 'unknown',
          success: true,
        },
      }
    }

    // If cloudId was provided, process the response
    if (!response.ok) {
      let message = `Failed to delete issue link (${response.status})`
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
        linkId: params?.linkId || 'unknown',
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
      description: 'Deletion details with timestamp, link ID, and success status',
    },
  },
}
