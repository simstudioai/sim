import type {
  PhotonGroupInfoResult,
  PhotonImessageGroupInfoParams,
} from '@/tools/photon_imessage/types'
import {
  jsonHeaders,
  parsePhotonResponse,
  photonCredentialParams,
} from '@/tools/photon_imessage/utils'
import type { ToolConfig } from '@/tools/types'

export const photonImessageGetGroupInfoTool: ToolConfig<
  PhotonImessageGroupInfoParams,
  PhotonGroupInfoResult
> = {
  id: 'photon_imessage_get_group_info',
  name: 'Get Group Info',
  description: 'Fetch the display name and member list of a group chat',
  version: '1.0.0',

  params: {
    ...photonCredentialParams,
    chatId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Group chat GUID to inspect',
    },
  },

  request: {
    // Photon reaches iMessage over gRPC through the spectrum-ts SDK, which cannot run as a plain
    // outbound fetch from the tool layer.
    url: '/api/tools/photon_imessage/group-info',
    method: 'POST',
    headers: jsonHeaders,
    body: (params: PhotonImessageGroupInfoParams) => ({
      projectId: params.projectId,
      projectSecret: params.projectSecret,
      chatId: params.chatId,
    }),
  },

  transformResponse: async (response: Response): Promise<PhotonGroupInfoResult> =>
    (await parsePhotonResponse(
      response,
      'Failed to fetch group info',
      { chatId: '', displayName: null, members: [] },
      (output) => ({
        chatId: (output.chatId as string) ?? '',
        displayName: (output.displayName as string | null) ?? null,
        members: (output.members as string[]) ?? [],
      })
    )) as PhotonGroupInfoResult,

  outputs: {
    chatId: { type: 'string', description: 'The group chat GUID' },
    displayName: { type: 'string', description: 'Group name, when one is set', optional: true },
    members: { type: 'json', description: 'Member handles as an array of strings' },
  },
}
