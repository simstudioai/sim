import type {
  PhotonImessageCreateGroupParams,
  PhotonSentResult,
} from '@/tools/photon_imessage/types'
import {
  jsonHeaders,
  parsePhotonResponse,
  photonCredentialParams,
} from '@/tools/photon_imessage/utils'
import type { ToolConfig } from '@/tools/types'

export const photonImessageCreateGroupTool: ToolConfig<
  PhotonImessageCreateGroupParams,
  PhotonSentResult
> = {
  id: 'photon_imessage_create_group',
  name: 'Create Group Chat',
  description:
    'Start a new group chat with two or more participants (requires a dedicated Photon line)',
  version: '1.0.0',

  params: {
    ...photonCredentialParams,
    handles: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: 'Participant phone numbers (E.164) or Apple ID emails, at least 2',
    },
    initialText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'First message to send into the new group',
    },
  },

  request: {
    // Photon reaches iMessage over gRPC through the spectrum-ts SDK, which cannot run as a plain
    // outbound fetch from the tool layer.
    url: '/api/tools/photon_imessage/create-group',
    method: 'POST',
    headers: jsonHeaders,
    body: (params: PhotonImessageCreateGroupParams) => ({
      projectId: params.projectId,
      projectSecret: params.projectSecret,
      handles: params.handles,
      initialText: params.initialText,
    }),
  },

  transformResponse: async (response: Response): Promise<PhotonSentResult> =>
    (await parsePhotonResponse(
      response,
      'Failed to create group chat',
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
