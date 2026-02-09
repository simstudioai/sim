import type { JiraUpdateParams, JiraUpdateResponse } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import type { ToolConfig } from '@/tools/types'

export const jiraUpdateTool: ToolConfig<JiraUpdateParams, JiraUpdateResponse> = {
  id: 'jira_update',
  name: 'Jira Update',
  description: 'Update a Jira issue',
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
      description: 'Jira issue key to update (e.g., PROJ-123)',
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
    priority: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New priority ID or name for the issue (e.g., "High")',
    },
    assignee: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New assignee account ID for the issue',
    },
    labels: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Labels to set on the issue (array of label name strings)',
    },
    components: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Components to set on the issue (array of component name strings)',
    },
    duedate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Due date for the issue (format: YYYY-MM-DD)',
    },
    fixVersions: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Fix versions to set (array of version name strings)',
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
      description: 'Custom field ID to update (e.g., customfield_10001)',
    },
    customFieldValue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Value for the custom field',
    },
    notifyUsers: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to send email notifications about this update (default: true)',
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
    url: '/api/tools/jira/update',
    method: 'PUT',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      return {
        domain: params.domain,
        accessToken: params.accessToken,
        issueKey: params.issueKey,
        summary: params.summary,
        description: params.description,
        priority: params.priority,
        assignee: params.assignee,
        labels: params.labels,
        components: params.components,
        duedate: params.duedate,
        fixVersions: params.fixVersions,
        environment: params.environment,
        customFieldId: params.customFieldId,
        customFieldValue: params.customFieldValue,
        notifyUsers: params.notifyUsers,
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

    if (data.success && data.output) {
      return data
    }

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
    ts: TIMESTAMP_OUTPUT,
    issueKey: { type: 'string', description: 'Updated issue key (e.g., PROJ-123)' },
    summary: { type: 'string', description: 'Issue summary after update' },
  },
}
