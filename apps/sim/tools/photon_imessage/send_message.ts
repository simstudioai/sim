import type {
  PhotonImessageSendMessageParams,
  PhotonImessageSendMessageResult,
} from '@/tools/photon_imessage/types'
import type { ToolConfig } from '@/tools/types'

export const photonImessageSendMessageTool: ToolConfig<
  PhotonImessageSendMessageParams,
  PhotonImessageSendMessageResult
> = {
  id: 'photon_imessage_send_message',
  name: 'Send iMessage',
  description:
    'Send an iMessage to a phone number or email address, or reply into an existing chat, through a Photon project',
  version: '1.0.0',

  params: {
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Photon project ID from app.photon.codes',
    },
    projectSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Photon project secret from app.photon.codes',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Recipient phone number in E.164 form (e.g. +14155551234) or an Apple ID email. Starts or reuses a direct conversation. Omit when using chatId.',
    },
    chatId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Existing chat GUID to send into, such as the chatId from an iMessage trigger. Required to reach a group chat. Omit when using to.',
    },
    text: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message text to send. iMessage is plain text, so Markdown is not rendered.',
    },
  },

  request: {
    // Photon reaches iMessage over gRPC through the spectrum-ts SDK, which cannot run as a plain
    // outbound fetch from the tool layer.
    url: '/api/tools/photon_imessage/send',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: PhotonImessageSendMessageParams) => ({
      projectId: params.projectId,
      projectSecret: params.projectSecret,
      to: params.to,
      chatId: params.chatId,
      text: params.text,
    }),
  },

  transformResponse: async (response: Response): Promise<PhotonImessageSendMessageResult> => {
    const data = await response.json()

    if (!data.success) {
      throw new Error(data.error || 'Failed to send iMessage')
    }

    return {
      success: true,
      output: {
        messageId: data.output?.messageId ?? null,
        chatId: data.output?.chatId ?? '',
        timestamp: data.output?.timestamp ?? null,
      },
    }
  },

  outputs: {
    messageId: {
      type: 'string',
      description: 'Identifier of the sent message',
      optional: true,
    },
    chatId: {
      type: 'string',
      description: 'Chat GUID the message was sent to. Pass this back to reply into the same chat.',
    },
    timestamp: {
      type: 'string',
      description: 'ISO 8601 time the message was sent',
      optional: true,
    },
  },
}
