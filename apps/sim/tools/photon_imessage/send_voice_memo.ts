import type { PhotonImessageSendVoiceParams, PhotonSentResult } from '@/tools/photon_imessage/types'
import {
  jsonHeaders,
  parsePhotonResponse,
  photonChatTargetParams,
  photonCredentialParams,
} from '@/tools/photon_imessage/utils'
import type { ToolConfig } from '@/tools/types'

export const photonImessageSendVoiceMemoTool: ToolConfig<
  PhotonImessageSendVoiceParams,
  PhotonSentResult
> = {
  id: 'photon_imessage_send_voice_memo',
  name: 'Send Voice Memo',
  description: 'Send an audio file as a native iMessage voice memo',
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
  },

  request: {
    // Photon reaches iMessage over gRPC through the spectrum-ts SDK, which cannot run as a plain
    // outbound fetch from the tool layer.
    url: '/api/tools/photon_imessage/send-voice',
    method: 'POST',
    headers: jsonHeaders,
    body: (params: PhotonImessageSendVoiceParams) => ({
      projectId: params.projectId,
      projectSecret: params.projectSecret,
      to: params.to,
      file: params.file,
      fileContent: params.fileContent,
      filename: params.filename,
      contentType: params.contentType,
    }),
  },

  transformResponse: async (response: Response): Promise<PhotonSentResult> =>
    (await parsePhotonResponse(
      response,
      'Failed to send voice memo',
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
