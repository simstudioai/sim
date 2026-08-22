import type { PhotonImessageReactParams, PhotonSentResult } from '@/tools/photon_imessage/types'
import {
  jsonHeaders,
  parsePhotonResponse,
  photonChatTargetParams,
  photonCredentialParams,
} from '@/tools/photon_imessage/utils'
import type { ToolConfig } from '@/tools/types'

export const photonImessageSendReactionTool: ToolConfig<
  PhotonImessageReactParams,
  PhotonSentResult
> = {
  id: 'photon_imessage_send_reaction',
  name: 'Send Tapback',
  description:
    'React to a message with an iMessage tapback (love, like, dislike, laugh, emphasize, question) or any emoji',
  version: '1.0.0',

  params: {
    ...photonCredentialParams,
    ...photonChatTargetParams,
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the message to react to, such as the messageId from an iMessage trigger',
    },
    emoji: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Reaction emoji. Heart, thumbs up, thumbs down, laugh, double exclamation, and question mark map to native tapbacks; any other emoji sends a custom emoji tapback.',
    },
  },

  request: {
    // Photon reaches iMessage over gRPC through the spectrum-ts SDK, which cannot run as a plain
    // outbound fetch from the tool layer.
    url: '/api/tools/photon_imessage/react',
    method: 'POST',
    headers: jsonHeaders,
    body: (params: PhotonImessageReactParams) => ({
      projectId: params.projectId,
      projectSecret: params.projectSecret,
      to: params.to,
      messageId: params.messageId,
      emoji: params.emoji,
    }),
  },

  transformResponse: async (response: Response): Promise<PhotonSentResult> =>
    (await parsePhotonResponse(
      response,
      'Failed to send tapback',
      { messageId: null, chatId: '', timestamp: null },
      (output) => ({
        messageId: (output.messageId as string | null) ?? null,
        chatId: (output.chatId as string) ?? '',
        timestamp: (output.timestamp as string | null) ?? null,
      })
    )) as PhotonSentResult,

  outputs: {
    messageId: {
      type: 'string',
      description: 'Identifier of the sent message',
      optional: true,
    },
    chatId: {
      type: 'string',
      description: 'Chat GUID the message was sent to. Pass this back to target the same chat.',
    },
    timestamp: {
      type: 'string',
      description: 'ISO 8601 time the message was sent',
      optional: true,
    },
  },
}
