import type { JiraUpdateParams, JiraUpdateResponse } from '@/tools/jira/types'
import { SUCCESS_OUTPUT, TIMESTAMP_OUTPUT } from '@/tools/jira/types'
import type { InternalToolConfig } from '@/tools/types'

interface JiraUpdateOperationEnvelope {
  success?: boolean
  output?: JiraUpdateResponse['output']
  error?: string
}

export const jiraUpdateTool: InternalToolConfig<JiraUpdateParams, JiraUpdateResponse> = {
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
      visibility: 'user-or-llm',
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

  operation: {
    input: (params) => {
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

    let data: JiraUpdateOperationEnvelope
    try {
      data = JSON.parse(responseText) as JiraUpdateOperationEnvelope
    } catch {
      throw new Error(
        `Jira update failed (${response.status} ${response.statusText}): non-JSON response from Jira operation`
      )
    }

    if (data.success && data.output) {
      return { success: true, output: data.output }
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
