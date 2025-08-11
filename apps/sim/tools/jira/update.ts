import type { JiraUpdateParams, JiraUpdateResponse } from '@/tools/jira/types'
import type { ToolConfig } from '@/tools/types'

export const jiraUpdateTool: ToolConfig<JiraUpdateParams, JiraUpdateResponse> = {
  id: 'jira_update',
  name: 'Jira Update',
  description: 'Update a Jira issue',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
    additionalScopes: ['read:jira-user', 'write:jira-work', 'write:issue:jira', 'read:jira-work'],
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
      visibility: 'user-only',
      description:
        'Jira project ID to update issues in. If not provided, all issues will be retrieved.',
    },
    issueKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Jira issue key to update',
    },
    summary: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New summary for the issue',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New description for the issue',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New status for the issue',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New priority for the issue',
    },
    assignee: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New assignee for the issue',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Jira Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: '/api/tools/jira/update',
    method: 'PUT',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      // Pass all parameters to the internal API route
      return {
        domain: params.domain,
        accessToken: params.accessToken,
        issueKey: params.issueKey,
        summary: params.summary,
        title: params.title, // Support both for backwards compatibility
        description: params.description,
        status: params.status,
        priority: params.priority,
        assignee: params.assignee,
        cloudId: params.cloudId,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()

    if (!responseText) {
      return {
        success: true,
        output: {
          ts: new Date().toISOString(),
          issueKey: 'unknown',
          summary: 'Issue updated successfully',
          success: true,
        },
      }
    }

    const data = JSON.parse(responseText)

    // The internal API route already returns the correct format
    if (data.success && data.output) {
      return data
    }

    // Fallback for unexpected response format
    return {
      success: data.success || false,
      output: data.output || {
        ts: new Date().toISOString(),
        issueKey: 'unknown',
        summary: 'Issue updated',
        success: false,
      },
      error: data.error,
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
        'Updated Jira issue details with timestamp, issue key, summary, and success status',
    },
  },
}
