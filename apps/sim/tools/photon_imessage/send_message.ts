import type {
  PhotonImessageSendMessageParams,
  PhotonSentResult,
} from '@/tools/photon_imessage/types'
import {
  jsonHeaders,
  parsePhotonResponse,
  photonChatTargetParams,
  photonCredentialParams,
} from '@/tools/photon_imessage/utils'
import type { ToolConfig } from '@/tools/types'

export const photonImessageSendMessageTool: ToolConfig<
  PhotonImessageSendMessageParams,
  PhotonSentResult
> = {
  id: 'photon_imessage_send_message',
  name: 'Send iMessage',
  description:
    'Send an iMessage to a phone number or email address, or into an existing chat, optionally as a reply or with a screen or bubble effect',
  version: '1.0.0',

  params: {
    ...photonCredentialParams,
    ...photonChatTargetParams,
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message text to send. iMessage is plain text, so Markdown is not rendered.',
    },
    effectName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Send with an iMessage effect: balloons, celebration, confetti, echo, fireworks, gentle, heart, invisible, lasers, loud, slam, sparkles, or spotlight',
    },
    replyToMessageId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Message ID to reply to inline (threaded reply)',
    },
  },

  request: {
    // Photon reaches iMessage over gRPC through the spectrum-ts SDK, which cannot run as a plain
    // outbound fetch from the tool layer.
    url: '/api/tools/photon_imessage/send',
    method: 'POST',
    headers: jsonHeaders,
    body: (params: PhotonImessageSendMessageParams) => ({
      projectId: params.projectId,
      projectSecret: params.projectSecret,
      to: params.to,
      text: params.text,
      effectName: params.effectName,
      replyToMessageId: params.replyToMessageId,
    }),
  },

  transformResponse: async (response: Response): Promise<PhotonSentResult> =>
    (await parsePhotonResponse(
      response,
      'Failed to send iMessage',
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
