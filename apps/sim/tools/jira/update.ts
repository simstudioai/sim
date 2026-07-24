import type { JiraUpdateParams, JiraUpdateResponse } from '@/tools/jira/types'
import { SUCCESS_OUTPUT, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
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
      description:
        'New description for the issue. Accepts plain text (auto-wrapped in ADF) or a raw ADF document object',
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
      description:
        'Legacy single custom field ID (e.g., customfield_10001). Sets one field to a raw string value. Prefer `customFields` for structured or multiple fields.',
    },
    customFieldValue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Raw value for the legacy single custom field. Prefer `customFields`.',
    },
    customFields: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Structured custom fields to set, as an array of { fieldId, type, value }. type is one of text | number | select | multiselect | userpicker | multiuserpicker | cascading | raw. Serialization: select→{value} (or {id} for numeric option ids); multiselect→[{value}]; userpicker→{accountId}; multiuserpicker→[{accountId}]; cascading→{value, child:{value}} (value = [parent, child] or {parent, child}); text/number→scalar; raw→passed through untouched.',
      items: {
        type: 'object',
        required: ['fieldId', 'type', 'value'],
        properties: {
          fieldId: { type: 'string', description: 'Custom field id, e.g. customfield_10001' },
          type: {
            type: 'string',
            description:
              'One of: text, number, select, multiselect, userpicker, multiuserpicker, cascading, raw',
          },
          value: {
            description:
              'The value to set; its shape depends on type (scalar, option, accountId, array, or cascading object)',
          },
        },
      },
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
        customFields: params.customFields,
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

    let data: any
    try {
      data = JSON.parse(responseText)
    } catch {
      throw new Error(
        `Jira update failed (${response.status} ${response.statusText}): non-JSON response from /api/tools/jira/update`
      )
    }

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
    success: SUCCESS_OUTPUT,
    issueKey: { type: 'string', description: 'Updated issue key (e.g., PROJ-123)' },
    summary: { type: 'string', description: 'Issue summary after update' },
  },
}
