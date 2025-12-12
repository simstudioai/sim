import type { JiraWriteParams, JiraWriteResponse } from '@/tools/jira/types'
import type { ToolConfig } from '@/tools/types'

export const jiraWriteTool: ToolConfig<JiraWriteParams, JiraWriteResponse> = {
  id: 'jira_write',
  name: 'Jira Write',
  description: 'Write a Jira issue',
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
      visibility: 'user-or-llm',
      description: 'Your Jira domain (e.g., yourcompany.atlassian.net)',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Project ID for the issue',
    },
    summary: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Summary for the issue',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description for the issue',
    },
    priority: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Priority for the issue',
    },
    assignee: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Assignee for the issue',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'Jira Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
    issueType: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Type of issue to create (e.g., Task, Story)',
    },
  },

  request: {
    url: '/api/tools/jira/write',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      // Pass all parameters to the internal API route
      return {
        domain: params.domain,
        accessToken: params.accessToken,
        projectId: params.projectId,
        summary: params.summary,
        description: params.description,
        priority: params.priority,
        assignee: params.assignee,
        cloudId: params.cloudId,
        issueType: params.issueType,
        parent: params.parent,
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
          summary: 'Issue created successfully',
          success: true,
          url: '',
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
        summary: 'Issue created',
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
        'Created Jira issue details with timestamp, issue key, summary, success status, and URL',
    },
  },
}
