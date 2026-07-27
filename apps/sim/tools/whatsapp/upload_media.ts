import type { ToolConfig } from '@/tools/types'
import type { WhatsAppUploadMediaParams, WhatsAppUploadMediaResponse } from '@/tools/whatsapp/types'

export const uploadMediaTool: ToolConfig<WhatsAppUploadMediaParams, WhatsAppUploadMediaResponse> = {
  id: 'whatsapp_upload_media',
  name: 'WhatsApp Upload Media',
  description:
    'Upload a file to WhatsApp and get a media ID for sending. Uploaded media is retained for 30 days and can back many sends.',
  version: '1.0.0',

  params: {
    file: {
      type: 'file',
      required: true,
      visibility: 'user-only',
      description:
        'File to upload. WhatsApp limits: images 5 MB, video and audio 16 MB, documents 100 MB, stickers 500 KB.',
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
    url: '/api/tools/whatsapp/upload-media',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      accessToken: params.accessToken,
      phoneNumberId: params.phoneNumberId,
      file: params.file,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to upload media to WhatsApp')
    }
    return { success: true, output: data.output }
  },

  outputs: {
    mediaId: {
      type: 'string',
      description: 'WhatsApp media ID. Pass this to Send Media to attach the uploaded file.',
    },
    fileName: { type: 'string', description: 'Name of the uploaded file' },
    mimeType: { type: 'string', description: 'MIME type WhatsApp received the file as' },
    size: { type: 'number', description: 'Size of the uploaded file in bytes' },
  },
}
