import type {
  OutlookGetAttachmentParams,
  OutlookGetAttachmentResponse,
} from '@/tools/outlook/types'
import { OUTLOOK_ATTACHMENT_METADATA_OUTPUT_PROPERTIES } from '@/tools/outlook/types'
import type { InternalToolConfig } from '@/tools/types'

export const outlookGetAttachmentTool: InternalToolConfig<
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

  operation: {
    modelInput: {
      mode: 'project',
      select: (params) => ({
        messageId: params.messageId,
        attachmentId: params.attachmentId,
      }),
    },
    input: (params) => ({
      accessToken: params.accessToken,
      messageId: params.messageId,
      attachmentId: params.attachmentId,
    }),
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
    },
  },
}
