import type { ToolConfig } from '@/tools/types'

export interface ConfluenceUploadAttachmentParams {
  accessToken: string
  domain: string
  pageId: string
  file: any
  fileName?: string
  comment?: string
  cloudId?: string
}

export interface ConfluenceUploadAttachmentResponse {
  success: boolean
  output: {
    ts: string
    attachmentId: string
    title: string
    fileSize: number
    mediaType: string
    downloadUrl: string
    pageId: string
  }
}

export const confluenceUploadAttachmentTool: ToolConfig<
  ConfluenceUploadAttachmentParams,
  ConfluenceUploadAttachmentResponse
> = {
  id: 'confluence_upload_attachment',
  name: 'Confluence Upload Attachment',
  description: 'Upload a file as an attachment to a Confluence page.',
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
    pageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Confluence page ID to attach the file to',
    },
    file: {
      type: 'file',
      required: true,
      visibility: 'user-or-llm',
      description: 'The file to upload as an attachment',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional custom file name for the attachment',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional comment to add to the attachment',
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
    url: () => '/api/tools/confluence/upload-attachment',
    method: 'POST',
    headers: (params: ConfluenceUploadAttachmentParams) => {
      return {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
    body: (params: ConfluenceUploadAttachmentParams) => {
      return {
        domain: params.domain,
        accessToken: params.accessToken,
        cloudId: params.cloudId,
        pageId: params.pageId,
        file: params.file,
        fileName: params.fileName,
        comment: params.comment,
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
        title: data.title || '',
        fileSize: data.fileSize || 0,
        mediaType: data.mediaType || '',
        downloadUrl: data.downloadUrl || '',
        pageId: data.pageId || '',
      },
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of upload' },
    attachmentId: { type: 'string', description: 'Uploaded attachment ID' },
    title: { type: 'string', description: 'Attachment file name' },
    fileSize: { type: 'number', description: 'File size in bytes' },
    mediaType: { type: 'string', description: 'MIME type of the attachment' },
    downloadUrl: { type: 'string', description: 'Download URL for the attachment' },
    pageId: { type: 'string', description: 'Page ID the attachment was added to' },
  },
}
