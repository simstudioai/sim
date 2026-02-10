import type { JiraAddAttachmentParams, JiraAddAttachmentResponse } from '@/tools/jira/types'
import { TIMESTAMP_OUTPUT } from '@/tools/jira/types'
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
      ts: TIMESTAMP_OUTPUT,
      issueKey: { type: 'string', description: 'Issue key' },
      attachments: {
        type: 'array',
        description: 'Uploaded attachments',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Attachment ID' },
            filename: { type: 'string', description: 'Attachment file name' },
            mimeType: { type: 'string', description: 'MIME type' },
            size: { type: 'number', description: 'File size in bytes' },
            content: { type: 'string', description: 'URL to download the attachment' },
          },
        },
      },
      attachmentIds: {
        type: 'array',
        description: 'Array of attachment IDs',
        items: { type: 'string' },
        optional: true,
      },
      files: {
        type: 'array',
        description: 'Uploaded file metadata',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'File name' },
            mimeType: { type: 'string', description: 'MIME type' },
            size: { type: 'number', description: 'File size in bytes' },
          },
        },
        optional: true,
      },
    },
  }
