import type {
  PhotonAvatarResult,
  PhotonImessageChatBackgroundParams,
} from '@/tools/photon_imessage/types'
import {
  jsonHeaders,
  parsePhotonResponse,
  photonChatTargetParams,
  photonCredentialParams,
} from '@/tools/photon_imessage/utils'
import type { ToolConfig } from '@/tools/types'

export const photonImessageSetChatBackgroundTool: ToolConfig<
  PhotonImessageChatBackgroundParams,
  PhotonAvatarResult
> = {
  id: 'photon_imessage_set_chat_background',
  name: 'Set Chat Background',
  description: 'Set or clear the shared background image of a conversation',
  version: '1.0.0',

  params: {
    ...photonCredentialParams,
    ...photonChatTargetParams,
    file: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'File to send, uploaded or referenced from a previous block',
    },
    fileContent: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Legacy base64 file content',
    },
    filename: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'File name including extension',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'MIME type of the file (inferred from the upload when omitted)',
    },
    clear: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set true to remove the current background instead of uploading one',
    },
  },

  request: {
    // Photon reaches iMessage over gRPC through the spectrum-ts SDK, which cannot run as a plain
    // outbound fetch from the tool layer.
    url: '/api/tools/photon_imessage/chat-background',
    method: 'POST',
    headers: jsonHeaders,
    body: (params: PhotonImessageChatBackgroundParams) => ({
      projectId: params.projectId,
      projectSecret: params.projectSecret,
      to: params.to,
      file: params.file,
      fileContent: params.fileContent,
      filename: params.filename,
      contentType: params.contentType,
      clear: params.clear,
    }),
  },

  transformResponse: async (response: Response): Promise<PhotonAvatarResult> =>
    (await parsePhotonResponse(
      response,
      'Failed to update chat background',
      { chatId: '', cleared: false },
      (output) => ({
        chatId: (output.chatId as string) ?? '',
        cleared: Boolean(output.cleared),
      })
    )) as PhotonAvatarResult,

  outputs: {
    chatId: { type: 'string', description: 'Chat GUID that was updated' },
    cleared: {
      type: 'boolean',
      description: 'True when the background was removed rather than set',
    },
  },
}
