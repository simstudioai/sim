import type {
  OutlookAttachment,
  OutlookGetAttachmentParams,
  OutlookGetAttachmentResponse,
} from '@/tools/outlook/types'
import {
  OUTLOOK_ATTACHMENT_METADATA_OUTPUT_PROPERTIES,
  OUTLOOK_ATTACHMENT_OUTPUT_PROPERTIES,
} from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

interface OutlookAttachmentApi {
  '@odata.type'?: string
  id: string
  name?: string
  contentType?: string
  size?: number
  isInline?: boolean
  lastModifiedDateTime?: string
  contentBytes?: string
}

export const outlookGetAttachmentTool: ToolConfig<
  OutlookGetAttachmentParams,
  OutlookGetAttachmentResponse
> = {
  id: 'outlook_get_attachment',
  name: 'Outlook Get Attachment',
  description: 'Get a single attachment on an Outlook message, including its file contents',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'outlook',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Outlook',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the message that owns the attachment',
    },
    attachmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the attachment to retrieve',
    },
  },

  request: {
    url: (params) =>
      `https://graph.microsoft.com/v1.0/me/messages/${params.messageId.trim()}/attachments/${params.attachmentId.trim()}`,
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const attachment: OutlookAttachmentApi = await response.json()

    const files: OutlookAttachment[] = []
    if (
      attachment['@odata.type'] === '#microsoft.graph.fileAttachment' &&
      attachment.contentBytes
    ) {
      files.push({
        name: attachment.name ?? 'attachment',
        data: attachment.contentBytes,
        contentType: attachment.contentType ?? 'application/octet-stream',
        size: attachment.size ?? 0,
      })
    }

    return {
      success: true,
      output: {
        message: `Successfully retrieved attachment "${attachment.name ?? ''}".`,
        results: {
          id: attachment.id,
          name: attachment.name ?? null,
          contentType: attachment.contentType ?? null,
          size: attachment.size ?? null,
          isInline: attachment.isInline ?? null,
          attachmentType: attachment['@odata.type'] ?? null,
          lastModifiedDateTime: attachment.lastModifiedDateTime ?? null,
        },
        attachments: files,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or status message' },
    results: {
      type: 'object',
      description: 'Attachment metadata',
      properties: OUTLOOK_ATTACHMENT_METADATA_OUTPUT_PROPERTIES,
    },
    attachments: {
      type: 'file[]',
      description: 'The downloaded file attachment (empty for non-file attachment types)',
      items: {
        type: 'object',
        properties: OUTLOOK_ATTACHMENT_OUTPUT_PROPERTIES,
      },
    },
  },
}
