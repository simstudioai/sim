import type { ForwardMessageParams, ForwardMessageResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailForwardMessageTool: ToolConfig<ForwardMessageParams, ForwardMessageResult> = {
  id: 'agentmail_forward_message',
  name: 'Forward Message',
  description: 'Forward an email message to new recipients in AgentMail',
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
      description: 'ID of the message to forward',
    },
    to: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recipient email addresses (comma-separated)',
    },
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Override subject line',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Additional plain text to prepend',
    },
    html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Additional HTML to prepend',
    },
    cc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'CC recipient email addresses (comma-separated)',
    },
    bcc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'BCC recipient email addresses (comma-separated)',
    },
  },

  request: {
    url: (params) =>
      `https://api.agentmail.to/v0/inboxes/${params.inboxId.trim()}/messages/${params.messageId.trim()}/forward`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        to: params.to.split(',').map((e) => e.trim()),
      }
      if (params.subject) body.subject = params.subject
      if (params.text) body.text = params.text
      if (params.html) body.html = params.html
      if (params.cc) body.cc = params.cc.split(',').map((e) => e.trim())
      if (params.bcc) body.bcc = params.bcc.split(',').map((e) => e.trim())
      return body
    },
  },

  transformResponse: async (response): Promise<ForwardMessageResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? 'Failed to forward message',
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
    messageId: { type: 'string', description: 'ID of the forwarded message' },
    threadId: { type: 'string', description: 'ID of the thread' },
  },
}
