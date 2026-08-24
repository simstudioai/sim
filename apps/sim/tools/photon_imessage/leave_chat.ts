import type {
  PhotonChatIdResult,
  PhotonImessageLeaveChatParams,
} from '@/tools/photon_imessage/types'
import {
  jsonHeaders,
  parsePhotonResponse,
  photonCredentialParams,
} from '@/tools/photon_imessage/utils'
import type { ToolConfig } from '@/tools/types'

export const photonImessageLeaveChatTool: ToolConfig<
  PhotonImessageLeaveChatParams,
  PhotonChatIdResult
> = {
  id: 'photon_imessage_leave_chat',
  name: 'Leave Group Chat',
  description: 'Remove the Photon line from a group chat',
  version: '1.0.0',

  params: {
    ...photonCredentialParams,
    chatId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Group chat GUID to leave',
    },
  },

  request: {
    // Photon reaches iMessage over gRPC through the spectrum-ts SDK, which cannot run as a plain
    // outbound fetch from the tool layer.
    url: '/api/tools/photon_imessage/leave-chat',
    method: 'POST',
    headers: jsonHeaders,
    body: (params: PhotonImessageLeaveChatParams) => ({
      projectId: params.projectId,
      projectSecret: params.projectSecret,
      chatId: params.chatId,
    }),
  },

  transformResponse: async (response: Response): Promise<PhotonChatIdResult> =>
    (await parsePhotonResponse(response, 'Failed to leave chat', { chatId: '' }, (output) => ({
      chatId: (output.chatId as string) ?? '',
    }))) as PhotonChatIdResult,

  outputs: {
    chatId: { type: 'string', description: 'Chat GUID the operation ran in' },
  },
}
