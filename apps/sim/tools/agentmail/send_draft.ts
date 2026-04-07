import type { SendDraftParams, SendDraftResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailSendDraftTool: ToolConfig<SendDraftParams, SendDraftResult> = {
  id: 'agentmail_send_draft',
  name: 'Send Draft',
  description: 'Send an existing email draft in AgentMail',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentMail API key',
    },
    inboxId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the inbox containing the draft',
    },
    draftId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the draft to send',
    },
  },

  request: {
    url: (params) =>
      `https://api.agentmail.to/v0/inboxes/${params.inboxId.trim()}/drafts/${params.draftId.trim()}/send`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: () => ({}),
  },

  transformResponse: async (response): Promise<SendDraftResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? 'Failed to send draft',
        output: { messageId: '', threadId: '' },
      }
    }

    return {
      success: true,
      output: {
        messageId: data.message_id ?? '',
        threadId: data.thread_id ?? '',
      },
    }
  },

  outputs: {
    messageId: { type: 'string', description: 'ID of the sent message' },
    threadId: { type: 'string', description: 'ID of the thread' },
  },
}
