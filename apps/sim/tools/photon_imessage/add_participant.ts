import type {
  PhotonImessageParticipantParams,
  PhotonParticipantResult,
} from '@/tools/photon_imessage/types'
import {
  jsonHeaders,
  parsePhotonResponse,
  photonCredentialParams,
} from '@/tools/photon_imessage/utils'
import type { ToolConfig } from '@/tools/types'

export const photonImessageAddParticipantTool: ToolConfig<
  PhotonImessageParticipantParams,
  PhotonParticipantResult
> = {
  id: 'photon_imessage_add_participant',
  name: 'Add Participant',
  description: 'Add a person to a group chat',
  version: '1.0.0',

  params: {
    ...photonCredentialParams,
    chatId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Group chat GUID to update',
    },
    handle: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Phone number (E.164) or Apple ID email of the participant',
    },
  },

  request: {
    // Photon reaches iMessage over gRPC through the spectrum-ts SDK, which cannot run as a plain
    // outbound fetch from the tool layer.
    url: '/api/tools/photon_imessage/add-participant',
    method: 'POST',
    headers: jsonHeaders,
    body: (params: PhotonImessageParticipantParams) => ({
      projectId: params.projectId,
      projectSecret: params.projectSecret,
      chatId: params.chatId,
      handle: params.handle,
    }),
  },

  transformResponse: async (response: Response): Promise<PhotonParticipantResult> =>
    (await parsePhotonResponse(
      response,
      'Failed to add participant',
      { chatId: '', handle: '' },
      (output) => ({
        chatId: (output.chatId as string) ?? '',
        handle: (output.handle as string) ?? '',
      })
    )) as PhotonParticipantResult,

  outputs: {
    chatId: { type: 'string', description: 'Chat GUID that was updated' },
    handle: { type: 'string', description: 'The participant handle' },
  },
}
