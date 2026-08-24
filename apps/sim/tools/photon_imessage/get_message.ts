import type {
  PhotonImessageGetMessageParams,
  PhotonMessageDetailsResult,
} from '@/tools/photon_imessage/types'
import {
  jsonHeaders,
  parsePhotonResponse,
  photonCredentialParams,
} from '@/tools/photon_imessage/utils'
import type { ToolConfig } from '@/tools/types'

export const photonImessageGetMessageTool: ToolConfig<
  PhotonImessageGetMessageParams,
  PhotonMessageDetailsResult
> = {
  id: 'photon_imessage_get_message',
  name: 'Get Message',
  description: 'Fetch a single message with its text, sender, and attachment metadata',
  version: '1.0.0',

  params: {
    ...photonCredentialParams,
    chatId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Chat GUID the message belongs to',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the message to fetch',
    },
  },

  request: {
    // Photon reaches iMessage over gRPC through the spectrum-ts SDK, which cannot run as a plain
    // outbound fetch from the tool layer.
    url: '/api/tools/photon_imessage/get-message',
    method: 'POST',
    headers: jsonHeaders,
    body: (params: PhotonImessageGetMessageParams) => ({
      projectId: params.projectId,
      projectSecret: params.projectSecret,
      chatId: params.chatId,
      messageId: params.messageId,
    }),
  },

  transformResponse: async (response: Response): Promise<PhotonMessageDetailsResult> =>
    (await parsePhotonResponse(
      response,
      'Failed to fetch message',
      {
        messageId: '',
        chatId: '',
        text: null,
        contentType: 'unknown',
        senderId: null,
        timestamp: null,
        attachments: [],
      },
      (output) => ({
        messageId: (output.messageId as string) ?? '',
        chatId: (output.chatId as string) ?? '',
        text: (output.text as string | null) ?? null,
        contentType: (output.contentType as string) ?? 'unknown',
        senderId: (output.senderId as string | null) ?? null,
        timestamp: (output.timestamp as string | null) ?? null,
        attachments:
          (output.attachments as Array<{
            id: string | null
            name: string | null
            mimeType: string | null
            size: number | null
          }>) ?? [],
      })
    )) as PhotonMessageDetailsResult,

  outputs: {
    messageId: { type: 'string', description: 'The message ID' },
    chatId: { type: 'string', description: 'Chat GUID the message belongs to' },
    text: {
      type: 'string',
      description: 'Plain-text content, when the message has any',
      optional: true,
    },
    contentType: {
      type: 'string',
      description: 'Content kind (text, attachment, reaction, and so on)',
    },
    senderId: { type: 'string', description: 'Sender handle', optional: true },
    timestamp: { type: 'string', description: 'ISO 8601 send time', optional: true },
    attachments: {
      type: 'json',
      description:
        'Attachment metadata as an array of { id, name, mimeType, size }, covering media and voice memos',
    },
  },
}
