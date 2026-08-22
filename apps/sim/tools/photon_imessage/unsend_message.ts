import type {
  PhotonImessageUnsendParams,
  PhotonMessageRefResult,
} from '@/tools/photon_imessage/types'
import {
  jsonHeaders,
  parsePhotonResponse,
  photonChatTargetParams,
  photonCredentialParams,
} from '@/tools/photon_imessage/utils'
import type { ToolConfig } from '@/tools/types'

export const photonImessageUnsendMessageTool: ToolConfig<
  PhotonImessageUnsendParams,
  PhotonMessageRefResult
> = {
  id: 'photon_imessage_unsend_message',
  name: 'Unsend Message',
  description: 'Retract a sent iMessage so it disappears from the recipient device',
  version: '1.0.0',

  params: {
    ...photonCredentialParams,
    ...photonChatTargetParams,
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the sent message to unsend',
    },
  },

  request: {
    // Photon reaches iMessage over gRPC through the spectrum-ts SDK, which cannot run as a plain
    // outbound fetch from the tool layer.
    url: '/api/tools/photon_imessage/unsend',
    method: 'POST',
    headers: jsonHeaders,
    body: (params: PhotonImessageUnsendParams) => ({
      projectId: params.projectId,
      projectSecret: params.projectSecret,
      to: params.to,
      messageId: params.messageId,
    }),
  },

  transformResponse: async (response: Response): Promise<PhotonMessageRefResult> =>
    (await parsePhotonResponse(
      response,
      'Failed to unsend message',
      { chatId: '', messageId: '' },
      (output) => ({
        chatId: (output.chatId as string) ?? '',
        messageId: (output.messageId as string) ?? '',
      })
    )) as PhotonMessageRefResult,

  outputs: {
    chatId: { type: 'string', description: 'Chat GUID the operation ran in' },
    messageId: { type: 'string', description: 'Identifier of the affected message' },
  },
}
