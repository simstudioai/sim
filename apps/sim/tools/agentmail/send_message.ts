import type { SendMessageParams, SendMessageResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailSendMessageTool: ToolConfig<SendMessageParams, SendMessageResult> = {
  id: 'agentmail_send_message',
  name: 'Send Message',
  description: 'Send an email message from an AgentMail inbox',
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
      description: 'ID of the inbox to send from',
    },
    to: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recipient email address (comma-separated for multiple)',
    },
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email subject line',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Plain text email body',
    },
    html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTML email body',
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
    url: (params) => `https://api.agentmail.to/v0/inboxes/${params.inboxId.trim()}/messages/send`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        to: params.to.split(',').map((e) => e.trim()),
        subject: params.subject,
      }
      if (params.text) body.text = params.text
      if (params.html) body.html = params.html
      if (params.cc) body.cc = params.cc.split(',').map((e) => e.trim())
      if (params.bcc) body.bcc = params.bcc.split(',').map((e) => e.trim())
      return body
    },
  },

  transformResponse: async (response, params): Promise<SendMessageResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? 'Failed to send message',
        output: {
          threadId: '',
          messageId: '',
          subject: '',
          to: '',
        },
      }
    }

    return {
      success: true,
      output: {
        threadId: data.thread_id ?? '',
        messageId: data.message_id ?? '',
        subject: params?.subject ?? '',
        to: params?.to ?? '',
      },
    }
  },

  outputs: {
    threadId: { type: 'string', description: 'ID of the created thread' },
    messageId: { type: 'string', description: 'ID of the sent message' },
    subject: { type: 'string', description: 'Email subject line' },
    to: { type: 'string', description: 'Recipient email address' },
  },
}
