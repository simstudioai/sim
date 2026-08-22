import type {
  PhotonChatIdResult,
  PhotonImessageShareContactCardParams,
} from '@/tools/photon_imessage/types'
import {
  jsonHeaders,
  parsePhotonResponse,
  photonChatTargetParams,
  photonCredentialParams,
} from '@/tools/photon_imessage/utils'
import type { ToolConfig } from '@/tools/types'

export const photonImessageShareContactCardTool: ToolConfig<
  PhotonImessageShareContactCardParams,
  PhotonChatIdResult
> = {
  id: 'photon_imessage_share_contact_card',
  name: 'Share Contact Card',
  description: 'Share the name-and-photo contact card of the Photon line into a conversation',
  version: '1.0.0',

  params: {
    ...photonCredentialParams,
    ...photonChatTargetParams,
  },

  request: {
    // Photon reaches iMessage over gRPC through the spectrum-ts SDK, which cannot run as a plain
    // outbound fetch from the tool layer.
    url: '/api/tools/photon_imessage/share-contact-card',
    method: 'POST',
    headers: jsonHeaders,
    body: (params: PhotonImessageShareContactCardParams) => ({
      projectId: params.projectId,
      projectSecret: params.projectSecret,
      to: params.to,
    }),
  },

  transformResponse: async (response: Response): Promise<PhotonChatIdResult> =>
    (await parsePhotonResponse(
      response,
      'Failed to share contact card',
      { chatId: '' },
      (output) => ({ chatId: (output.chatId as string) ?? '' })
    )) as PhotonChatIdResult,

  outputs: {
    chatId: { type: 'string', description: 'Chat GUID the operation ran in' },
  },
}
