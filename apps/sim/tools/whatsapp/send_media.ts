import type { ToolConfig } from '@/tools/types'
import type {
  WhatsAppMediaType,
  WhatsAppSendMediaParams,
  WhatsAppSendResponse,
} from '@/tools/whatsapp/types'
import {
  buildAuthHeaders,
  buildMessagesUrl,
  transformWhatsAppSendResponse,
  whatsappSendOutputs,
} from '@/tools/whatsapp/utils'

const MEDIA_TYPES: readonly WhatsAppMediaType[] = ['image', 'document', 'video', 'audio']

const CAPTION_TYPES: ReadonlySet<WhatsAppMediaType> = new Set(['image', 'video', 'document'])

export const sendMediaTool: ToolConfig<WhatsAppSendMediaParams, WhatsAppSendResponse> = {
  id: 'whatsapp_send_media',
  name: 'WhatsApp Send Media',
  description:
    'Send an image, document, video, or audio message via a public link or an uploaded media ID.',
  version: '1.0.0',

  params: {
    phoneNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recipient phone number with country code (e.g., +14155552671)',
    },
    mediaType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Type of media to send: image, document, video, or audio',
    },
    mediaLink: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Public HTTPS URL of the media (provide this or mediaId)',
    },
    mediaId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of media previously uploaded to WhatsApp (provide this or mediaLink)',
    },
    caption: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional caption for image, video, or document media',
    },
    filename: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional file name shown to the recipient for document media',
    },
    phoneNumberId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'WhatsApp Business Phone Number ID (from Meta Business Suite)',
    },
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'WhatsApp Business API Access Token (from Meta Developer Portal)',
    },
  },

  request: {
    url: (params) => buildMessagesUrl(params.phoneNumberId),
    method: 'POST',
    headers: (params) => buildAuthHeaders(params.accessToken),
    body: (params) => {
      if (!params.phoneNumber) {
        throw new Error('Phone number is required but was not provided')
      }

      const mediaType = params.mediaType?.trim() as WhatsAppMediaType
      if (!MEDIA_TYPES.includes(mediaType)) {
        throw new Error(`Media type must be one of: ${MEDIA_TYPES.join(', ')}`)
      }

      const link = params.mediaLink?.trim()
      const id = params.mediaId?.trim()
      if (!link && !id) {
        throw new Error('Either mediaLink or mediaId is required')
      }

      const media: Record<string, string> = id ? { id } : { link: link as string }
      if (params.caption && CAPTION_TYPES.has(mediaType)) {
        media.caption = params.caption
      }
      if (params.filename && mediaType === 'document') {
        media.filename = params.filename
      }

      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: params.phoneNumber.trim(),
        type: mediaType,
        [mediaType]: media,
      }
    },
  },

  transformResponse: transformWhatsAppSendResponse,

  outputs: whatsappSendOutputs,
}
