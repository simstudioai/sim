import type { ReplyMessageParams, ReplyMessageResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailReplyMessageTool: ToolConfig<ReplyMessageParams, ReplyMessageResult> = {
  id: 'agentmail_reply_message',
  name: 'Reply to Message',
  description: 'Reply to an existing email message in AgentMail',
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
      description: 'ID of the inbox to reply from',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the message to reply to',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Plain text reply body',
    },
    html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTML reply body',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Override recipient email addresses (comma-separated)',
    },
    cc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'CC email addresses (comma-separated)',
    },
    bcc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'BCC email addresses (comma-separated)',
    },
    replyAll: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reply to all recipients of the original message',
    },
  },

  request: {
    url: (params) => {
      const endpoint = params.replyAll ? 'reply-all' : 'reply'
      return `https://api.agentmail.to/v0/inboxes/${params.inboxId.trim()}/messages/${params.messageId.trim()}/${endpoint}`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.text) body.text = params.text
      if (params.html) body.html = params.html
      // /reply-all endpoint auto-determines recipients; only /reply accepts to/cc/bcc
      if (!params.replyAll) {
        if (params.to) body.to = params.to.split(',').map((e) => e.trim())
        if (params.cc) body.cc = params.cc.split(',').map((e) => e.trim())
        if (params.bcc) body.bcc = params.bcc.split(',').map((e) => e.trim())
      }
      return body
    },
  },

  transformResponse: async (response): Promise<ReplyMessageResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? 'Failed to reply to message',
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
    messageId: { type: 'string', description: 'ID of the sent reply message' },
    threadId: { type: 'string', description: 'ID of the thread' },
  },
}
