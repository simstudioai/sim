import type {
  CleanedOutlookAttachmentMetadata,
  OutlookListAttachmentsParams,
  OutlookListAttachmentsResponse,
} from '@/tools/outlook/types'
import { OUTLOOK_ATTACHMENT_METADATA_OUTPUT_PROPERTIES } from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

interface OutlookAttachmentApi {
  '@odata.type'?: string
  id: string
  name?: string
  contentType?: string
  size?: number
  isInline?: boolean
  lastModifiedDateTime?: string
}

export const outlookListAttachmentsTool: ToolConfig<
  OutlookListAttachmentsParams,
  OutlookListAttachmentsResponse
> = {
  id: 'outlook_list_attachments',
  name: 'Outlook List Attachments',
  description: 'List the attachments on an Outlook message (metadata only, without contents)',
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
      description: 'The ID of the message whose attachments to list',
    },
  },

  request: {
    url: (params) =>
      `https://graph.microsoft.com/v1.0/me/messages/${params.messageId.trim()}/attachments?$select=id,name,contentType,size,isInline,lastModifiedDateTime`,
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
    const data = await response.json()
    const attachments: OutlookAttachmentApi[] = data.value || []

    const cleanedAttachments: CleanedOutlookAttachmentMetadata[] = attachments.map(
      (attachment) => ({
        id: attachment.id,
        name: attachment.name ?? null,
        contentType: attachment.contentType ?? null,
        size: attachment.size ?? null,
        isInline: attachment.isInline ?? null,
        attachmentType: attachment['@odata.type'] ?? null,
        lastModifiedDateTime: attachment.lastModifiedDateTime ?? null,
      })
    )

    return {
      success: true,
      output: {
        message: `Successfully retrieved ${cleanedAttachments.length} attachment(s).`,
        results: cleanedAttachments,
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or status message' },
    results: {
      type: 'array',
      description: 'Array of attachment metadata objects',
      items: {
        type: 'object',
        properties: OUTLOOK_ATTACHMENT_METADATA_OUTPUT_PROPERTIES,
      },
    },
  },
}
