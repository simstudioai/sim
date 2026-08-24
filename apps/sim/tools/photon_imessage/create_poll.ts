import type {
  PhotonImessageCreatePollParams,
  PhotonSentResult,
} from '@/tools/photon_imessage/types'
import {
  jsonHeaders,
  parsePhotonResponse,
  photonChatTargetParams,
  photonCredentialParams,
} from '@/tools/photon_imessage/utils'
import type { ToolConfig } from '@/tools/types'

export const photonImessageCreatePollTool: ToolConfig<
  PhotonImessageCreatePollParams,
  PhotonSentResult
> = {
  id: 'photon_imessage_create_poll',
  name: 'Create Poll',
  description: 'Create a native iMessage poll with 2-10 options',
  version: '1.0.0',

  params: {
    ...photonCredentialParams,
    ...photonChatTargetParams,
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Poll question (up to 300 characters)',
    },
    options: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Poll choices as an array of 2-10 strings',
    },
  },

  request: {
    // Photon reaches iMessage over gRPC through the spectrum-ts SDK, which cannot run as a plain
    // outbound fetch from the tool layer.
    url: '/api/tools/photon_imessage/create-poll',
    method: 'POST',
    headers: jsonHeaders,
    body: (params: PhotonImessageCreatePollParams) => ({
      projectId: params.projectId,
      projectSecret: params.projectSecret,
      to: params.to,
      title: params.title,
      options: params.options,
    }),
  },

  transformResponse: async (response: Response): Promise<PhotonSentResult> =>
    (await parsePhotonResponse(
      response,
      'Failed to create poll',
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
