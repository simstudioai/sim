import type { ToolConfig } from '@/tools/types'

export interface ConfluenceDeleteAttachmentParams {
  accessToken: string
  domain: string
  attachmentId: string
  cloudId?: string
}

export interface ConfluenceDeleteAttachmentResponse {
  success: boolean
  output: {
    ts: string
    attachmentId: string
    deleted: boolean
  }
}

export const confluenceDeleteAttachmentTool: ToolConfig<
  ConfluenceDeleteAttachmentParams,
  ConfluenceDeleteAttachmentResponse
> = {
  id: 'confluence_delete_attachment',
  name: 'Confluence Delete Attachment',
  description: 'Delete an attachment from a Confluence page (moves to trash).',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'confluence',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Confluence',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your Confluence domain (e.g., yourcompany.atlassian.net)',
    },
    attachmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Confluence attachment ID to delete',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Confluence Cloud ID for the instance. If not provided, it will be fetched using the domain.',
    },
  },

  request: {
    url: () => '/api/tools/confluence/attachment',
    method: 'DELETE',
    headers: (params: ConfluenceDeleteAttachmentParams) => {
      return {
        Accept: 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: ConfluenceDeleteAttachmentParams) => {
      return {
        domain: params.domain,
        accessToken: params.accessToken,
        cloudId: params.cloudId,
        attachmentId: params.attachmentId,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        ts: new Date().toISOString(),
        attachmentId: data.attachmentId || '',
        deleted: true,
      },
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of deletion' },
    attachmentId: { type: 'string', description: 'Deleted attachment ID' },
    deleted: { type: 'boolean', description: 'Deletion status' },
  },
}
