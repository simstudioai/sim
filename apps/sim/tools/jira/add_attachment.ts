import type { JiraAddAttachmentParams, JiraAddAttachmentResponse } from '@/tools/jira/types'
import type { ToolConfig } from '@/tools/types'

export const jiraAddAttachmentTool: ToolConfig<JiraAddAttachmentParams, JiraAddAttachmentResponse> =
  {
    id: 'jira_add_attachment',
    name: 'Jira Add Attachment',
    description: 'Add attachments to a Jira issue',
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
        description: 'Jira issue key to add attachments to (e.g., PROJ-123)',
      },
      files: {
        type: 'file[]',
        required: true,
        visibility: 'hidden',
        description: 'Files to attach to the Jira issue',
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
      url: '/api/tools/jira/add-attachment',
      method: 'POST',
      headers: () => ({
        'Content-Type': 'application/json',
      }),
      body: (params: JiraAddAttachmentParams) => ({
        accessToken: params.accessToken,
        domain: params.domain,
        issueKey: params.issueKey,
        files: params.files,
        cloudId: params.cloudId,
      }),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to add Jira attachment')
      }

      return {
        success: true,
        output: data.output,
      }
    },

    outputs: {
      ts: { type: 'string', description: 'Timestamp of the operation' },
      issueKey: { type: 'string', description: 'Issue key' },
      attachmentIds: { type: 'json', description: 'IDs of uploaded attachments' },
      files: { type: 'file[]', description: 'Uploaded attachment files' },
    },
  }
