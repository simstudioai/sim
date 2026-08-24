import type {
  PhotonImessageRenameChatParams,
  PhotonRenameResult,
} from '@/tools/photon_imessage/types'
import {
  jsonHeaders,
  parsePhotonResponse,
  photonCredentialParams,
} from '@/tools/photon_imessage/utils'
import type { ToolConfig } from '@/tools/types'

export const photonImessageRenameChatTool: ToolConfig<
  PhotonImessageRenameChatParams,
  PhotonRenameResult
> = {
  id: 'photon_imessage_rename_chat',
  name: 'Rename Group Chat',
  description: 'Change the display name of a group chat',
  version: '1.0.0',

  params: {
    ...photonCredentialParams,
    chatId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Group chat GUID to rename',
    },
    displayName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'New group chat name',
    },
  },

  request: {
    // Photon reaches iMessage over gRPC through the spectrum-ts SDK, which cannot run as a plain
    // outbound fetch from the tool layer.
    url: '/api/tools/photon_imessage/rename-chat',
    method: 'POST',
    headers: jsonHeaders,
    body: (params: PhotonImessageRenameChatParams) => ({
      projectId: params.projectId,
      projectSecret: params.projectSecret,
      chatId: params.chatId,
      displayName: params.displayName,
    }),
  },

  transformResponse: async (response: Response): Promise<PhotonRenameResult> =>
    (await parsePhotonResponse(
      response,
      'Failed to rename chat',
      { chatId: '', displayName: '' },
      (output) => ({
        chatId: (output.chatId as string) ?? '',
        displayName: (output.displayName as string) ?? '',
      })
    )) as PhotonRenameResult,

  outputs: {
    chatId: { type: 'string', description: 'Chat GUID that was renamed' },
    displayName: { type: 'string', description: 'The new chat name' },
  },
}
