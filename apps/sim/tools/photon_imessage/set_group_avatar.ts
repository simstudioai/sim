import type {
  PhotonAvatarResult,
  PhotonImessageGroupAvatarParams,
} from '@/tools/photon_imessage/types'
import {
  jsonHeaders,
  parsePhotonResponse,
  photonCredentialParams,
} from '@/tools/photon_imessage/utils'
import type { ToolConfig } from '@/tools/types'

export const photonImessageSetGroupAvatarTool: ToolConfig<
  PhotonImessageGroupAvatarParams,
  PhotonAvatarResult
> = {
  id: 'photon_imessage_set_group_avatar',
  name: 'Set Group Photo',
  description: 'Set or clear the photo of a group chat',
  version: '1.0.0',

  params: {
    ...photonCredentialParams,
    chatId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Group chat GUID to update',
    },
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
      description: 'Set true to remove the current group photo instead of uploading one',
    },
  },

  request: {
    // Photon reaches iMessage over gRPC through the spectrum-ts SDK, which cannot run as a plain
    // outbound fetch from the tool layer.
    url: '/api/tools/photon_imessage/group-avatar',
    method: 'POST',
    headers: jsonHeaders,
    body: (params: PhotonImessageGroupAvatarParams) => ({
      projectId: params.projectId,
      projectSecret: params.projectSecret,
      chatId: params.chatId,
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
      'Failed to update group photo',
      { chatId: '', cleared: false },
      (output) => ({
        chatId: (output.chatId as string) ?? '',
        cleared: Boolean(output.cleared),
      })
    )) as PhotonAvatarResult,

  outputs: {
    chatId: { type: 'string', description: 'Chat GUID that was updated' },
    cleared: { type: 'boolean', description: 'True when the photo was removed rather than set' },
  },
}
