import type { ToolConfig } from '@/tools/types'
import type { WhatsAppSendMediaParams, WhatsAppSendResponse } from '@/tools/whatsapp/types'
import { whatsappSendOutputs } from '@/tools/whatsapp/utils'

export const sendMediaTool: ToolConfig<WhatsAppSendMediaParams, WhatsAppSendResponse> = {
  id: 'whatsapp_send_media',
  name: 'WhatsApp Send Media',
  description:
    'Send an image, document, video, audio, or sticker message. Accepts an uploaded file, a media ID, or a public link.',
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
      description: 'Type of media to send: image, document, video, audio, or sticker',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description:
        'File to send. Uploaded to WhatsApp first, then sent. Use Upload Media instead when sending the same file repeatedly.',
    },
    mediaId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of media previously uploaded to WhatsApp. Alternative to file or mediaLink.',
    },
    mediaLink: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Public HTTPS URL of the media. Alternative to file or mediaId.',
    },
    caption: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional caption for image, video, or document media (max 1024 characters). Ignored for audio and sticker.',
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

  // Routed server-side so an uploaded file can be pushed to `/media` for a media ID
  // before the `/messages` send. Link and media-ID sends pass straight through.
  request: {
    url: '/api/tools/whatsapp/send-media',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      accessToken: params.accessToken,
      phoneNumberId: params.phoneNumberId,
      phoneNumber: params.phoneNumber,
      mediaType: params.mediaType,
      file: params.file,
      mediaId: params.mediaId,
      mediaLink: params.mediaLink,
      caption: params.caption,
      filename: params.filename,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to send WhatsApp media')
    }
    return { success: true, output: data.output }
  },

  outputs: whatsappSendOutputs,
}
