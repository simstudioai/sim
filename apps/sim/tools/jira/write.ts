import type { JiraWriteParams, JiraWriteResponse } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import type { ToolConfig } from '@/tools/types'

export const jiraWriteTool: ToolConfig<JiraWriteParams, JiraWriteResponse> = {
  id: 'jira_write',
  name: 'Jira Write',
  description: 'Create a new Jira issue',
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
      visibility: 'user-or-llm',
      description: 'Jira project key (e.g., PROJ)',
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
      visibility: 'user-or-llm',
      description: 'Priority ID or name for the issue (e.g., "10000" or "High")',
    },
    assignee: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Assignee account ID for the issue',
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
      visibility: 'user-or-llm',
      description: 'Type of issue to create (e.g., Task, Story, Bug, Epic, Sub-task)',
    },
    parent: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parent issue key for creating subtasks (e.g., { "key": "PROJ-123" })',
    },
    labels: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Labels for the issue (array of label names)',
    },
    components: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Components for the issue (array of component names)',
    },
    duedate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date for the issue (format: YYYY-MM-DD)',
    },
    fixVersions: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fix versions for the issue (array of version names)',
    },
    reporter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reporter account ID for the issue',
    },
    environment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Environment information for the issue',
    },
    customFieldId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom field ID (e.g., customfield_10001)',
    },
    customFieldValue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Value for the custom field',
    },
  },

  request: {
    url: '/api/tools/jira/write',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
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
        labels: params.labels,
        components: params.components,
        duedate: params.duedate,
        fixVersions: params.fixVersions,
        reporter: params.reporter,
        environment: params.environment,
        customFieldId: params.customFieldId,
        customFieldValue: params.customFieldValue,
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
          id: '',
          issueKey: 'unknown',
          self: '',
          summary: 'Issue created successfully',
          success: true,
          url: '',
        },
      }
    }

    const data = JSON.parse(responseText)

    if (data.success && data.output) {
      return {
        success: data.success,
        output: {
          ts: data.output.ts ?? new Date().toISOString(),
          id: data.output.id ?? '',
          issueKey: data.output.issueKey ?? 'unknown',
          self: data.output.self ?? '',
          summary: data.output.summary ?? '',
          success: data.output.success ?? true,
          url: data.output.url ?? '',
        },
      }
    }

    return {
      success: data.success || false,
      output: {
        ts: new Date().toISOString(),
        id: data.output?.id ?? '',
        issueKey: data.output?.issueKey ?? 'unknown',
        self: data.output?.self ?? '',
        summary: data.output?.summary ?? 'Issue created',
        success: false,
        url: data.output?.url ?? '',
      },
      error: data.error,
    }
  },

  outputs: {
    ts: TIMESTAMP_OUTPUT,
    id: { type: 'string', description: 'Created issue ID' },
    issueKey: { type: 'string', description: 'Created issue key (e.g., PROJ-123)' },
    self: { type: 'string', description: 'REST API URL for the created issue' },
    summary: { type: 'string', description: 'Issue summary' },
    url: { type: 'string', description: 'URL to the created issue in Jira' },
  },
}
