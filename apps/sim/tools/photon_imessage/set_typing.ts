import type { PhotonImessageTypingParams, PhotonTypingResult } from '@/tools/photon_imessage/types'
import {
  jsonHeaders,
  parsePhotonResponse,
  photonChatTargetParams,
  photonCredentialParams,
} from '@/tools/photon_imessage/utils'
import type { ToolConfig } from '@/tools/types'

export const photonImessageSetTypingTool: ToolConfig<
  PhotonImessageTypingParams,
  PhotonTypingResult
> = {
  id: 'photon_imessage_set_typing',
  name: 'Typing Indicator',
  description: 'Show or hide the typing indicator in a conversation',
  version: '1.0.0',

  params: {
    ...photonCredentialParams,
    ...photonChatTargetParams,
    state: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Either start to show the typing indicator or stop to hide it',
    },
  },

  request: {
    // Photon reaches iMessage over gRPC through the spectrum-ts SDK, which cannot run as a plain
    // outbound fetch from the tool layer.
    url: '/api/tools/photon_imessage/typing',
    method: 'POST',
    headers: jsonHeaders,
    body: (params: PhotonImessageTypingParams) => ({
      projectId: params.projectId,
      projectSecret: params.projectSecret,
      to: params.to,
      state: params.state,
    }),
  },

  transformResponse: async (response: Response): Promise<PhotonTypingResult> =>
    (await parsePhotonResponse(
      response,
      'Failed to update typing indicator',
      { chatId: '', state: '' },
      (output) => ({
        chatId: (output.chatId as string) ?? '',
        state: (output.state as string) ?? '',
      })
    )) as PhotonTypingResult,

  outputs: {
    chatId: { type: 'string', description: 'Chat GUID the indicator was updated in' },
    state: { type: 'string', description: 'Resulting indicator state (start or stop)' },
  },
}
