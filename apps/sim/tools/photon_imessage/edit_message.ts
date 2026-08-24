import type { PhotonImessageEditParams, PhotonSentResult } from '@/tools/photon_imessage/types'
import {
  jsonHeaders,
  parsePhotonResponse,
  photonChatTargetParams,
  photonCredentialParams,
} from '@/tools/photon_imessage/utils'
import type { ToolConfig } from '@/tools/types'

export const photonImessageEditMessageTool: ToolConfig<PhotonImessageEditParams, PhotonSentResult> =
  {
    id: 'photon_imessage_edit_message',
    name: 'Edit Message',
    description: 'Edit the text of a previously sent iMessage in place',
    version: '1.0.0',

    params: {
      ...photonCredentialParams,
      ...photonChatTargetParams,
      messageId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the sent message to edit',
      },
      text: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Replacement text',
      },
    },

    request: {
      // Photon reaches iMessage over gRPC through the spectrum-ts SDK, which cannot run as a plain
      // outbound fetch from the tool layer.
      url: '/api/tools/photon_imessage/edit',
      method: 'POST',
      headers: jsonHeaders,
      body: (params: PhotonImessageEditParams) => ({
        projectId: params.projectId,
        projectSecret: params.projectSecret,
        to: params.to,
        messageId: params.messageId,
        text: params.text,
      }),
    },

    transformResponse: async (response: Response): Promise<PhotonSentResult> =>
      (await parsePhotonResponse(
        response,
        'Failed to edit message',
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
