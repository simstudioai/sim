import type { ToolConfig } from '@/tools/types'
import type { WhatsAppGetMediaParams, WhatsAppGetMediaResponse } from '@/tools/whatsapp/types'

function getExecutionContext(params: WhatsAppGetMediaParams): {
  workspaceId?: string
  workflowId?: string
  executionId?: string
} {
  const context = params._context
  return {
    workspaceId: typeof context?.workspaceId === 'string' ? context.workspaceId : undefined,
    workflowId: typeof context?.workflowId === 'string' ? context.workflowId : undefined,
    executionId: typeof context?.executionId === 'string' ? context.executionId : undefined,
  }
}

export const getMediaTool: ToolConfig<WhatsAppGetMediaParams, WhatsAppGetMediaResponse> = {
  id: 'whatsapp_get_media',
  name: 'WhatsApp Download Media',
  description:
    'Download media a customer sent you. Takes the media ID from an incoming WhatsApp message and stores the file in the workflow.',
  version: '1.0.0',

  params: {
    mediaId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Media asset ID from an incoming message, e.g. <whatsapp.messages[0].mediaId>. This is not the message ID (wamid).',
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
    url: '/api/tools/whatsapp/get-media',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      accessToken: params.accessToken,
      mediaId: params.mediaId,
      phoneNumberId: params.phoneNumberId,
      ...getExecutionContext(params),
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!data.success) {
      throw new Error(data.error || 'Failed to download WhatsApp media')
    }
    return { success: true, output: data.output }
  },

  outputs: {
    file: { type: 'file', description: 'Downloaded media stored as a workflow file' },
    mediaId: { type: 'string', description: 'WhatsApp media ID that was downloaded' },
    mimeType: { type: 'string', description: 'MIME type reported by WhatsApp' },
    fileSize: { type: 'number', description: 'Size of the downloaded media in bytes' },
    sha256: {
      type: 'string',
      description: 'SHA-256 hash WhatsApp reported for the media, for integrity checks',
      optional: true,
    },
  },
}
