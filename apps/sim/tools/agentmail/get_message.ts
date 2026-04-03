import type { GetMessageParams, GetMessageResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailGetMessageTool: ToolConfig<GetMessageParams, GetMessageResult> = {
  id: 'agentmail_get_message',
  name: 'Get Message',
  description: 'Get details of a specific email message in AgentMail',
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
      description: 'ID of the inbox containing the message',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the message to retrieve',
    },
  },

  request: {
    url: (params) =>
      `https://api.agentmail.to/v0/inboxes/${params.inboxId.trim()}/messages/${params.messageId.trim()}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<GetMessageResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? 'Failed to get message',
        output: {
          messageId: '',
          threadId: '',
          from: null,
          to: [],
          cc: [],
          bcc: [],
          subject: null,
          text: null,
          html: null,
          createdAt: '',
        },
      }
    }

    return {
      success: true,
      output: {
        messageId: data.message_id ?? '',
        threadId: data.thread_id ?? '',
        from: data.from ?? null,
        to: data.to ?? [],
        cc: data.cc ?? [],
        bcc: data.bcc ?? [],
        subject: data.subject ?? null,
        text: data.text ?? null,
        html: data.html ?? null,
        createdAt: data.created_at ?? '',
      },
    }
  },

  outputs: {
    messageId: { type: 'string', description: 'Unique identifier for the message' },
    threadId: { type: 'string', description: 'ID of the thread this message belongs to' },
    from: { type: 'string', description: 'Sender email address', optional: true },
    to: { type: 'array', description: 'Recipient email addresses' },
    cc: { type: 'array', description: 'CC email addresses' },
    bcc: { type: 'array', description: 'BCC email addresses' },
    subject: { type: 'string', description: 'Message subject', optional: true },
    text: { type: 'string', description: 'Plain text content', optional: true },
    html: { type: 'string', description: 'HTML content', optional: true },
    createdAt: { type: 'string', description: 'Creation timestamp' },
  },
}
