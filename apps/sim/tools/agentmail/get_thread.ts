import type { GetThreadParams, GetThreadResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailGetThreadTool: ToolConfig<GetThreadParams, GetThreadResult> = {
  id: 'agentmail_get_thread',
  name: 'Get Thread',
  description: 'Get details of a specific email thread including messages in AgentMail',
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
      description: 'ID of the inbox containing the thread',
    },
    threadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the thread to retrieve',
    },
  },

  request: {
    url: (params) =>
      `https://api.agentmail.to/v0/inboxes/${params.inboxId.trim()}/threads/${params.threadId.trim()}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<GetThreadResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? 'Failed to get thread',
        output: {
          threadId: '',
          subject: null,
          senders: [],
          recipients: [],
          messageCount: 0,
          labels: [],
          lastMessageAt: null,
          createdAt: '',
          updatedAt: '',
          messages: [],
        },
      }
    }

    return {
      success: true,
      output: {
        threadId: data.thread_id ?? '',
        subject: data.subject ?? null,
        senders: data.senders ?? [],
        recipients: data.recipients ?? [],
        messageCount: data.message_count ?? 0,
        labels: data.labels ?? [],
        lastMessageAt: data.timestamp ?? null,
        createdAt: data.created_at ?? '',
        updatedAt: data.updated_at ?? '',
        messages: (data.messages ?? []).map((msg: Record<string, unknown>) => ({
          messageId: msg.message_id ?? '',
          from: (msg.from as string) ?? null,
          to: (msg.to as string[]) ?? [],
          cc: (msg.cc as string[]) ?? [],
          bcc: (msg.bcc as string[]) ?? [],
          subject: (msg.subject as string) ?? null,
          text: (msg.text as string) ?? null,
          html: (msg.html as string) ?? null,
          createdAt: (msg.created_at as string) ?? '',
        })),
      },
    }
  },

  outputs: {
    threadId: { type: 'string', description: 'Unique identifier for the thread' },
    subject: { type: 'string', description: 'Thread subject', optional: true },
    senders: { type: 'array', description: 'List of sender email addresses' },
    recipients: { type: 'array', description: 'List of recipient email addresses' },
    messageCount: { type: 'number', description: 'Number of messages in the thread' },
    labels: { type: 'array', description: 'Labels assigned to the thread' },
    lastMessageAt: { type: 'string', description: 'Timestamp of last message', optional: true },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    updatedAt: { type: 'string', description: 'Last updated timestamp' },
    messages: {
      type: 'array',
      description: 'Messages in the thread',
      items: {
        type: 'object',
        properties: {
          messageId: { type: 'string', description: 'Unique identifier for the message' },
          from: { type: 'string', description: 'Sender email address', optional: true },
          to: { type: 'array', description: 'Recipient email addresses' },
          cc: { type: 'array', description: 'CC email addresses' },
          bcc: { type: 'array', description: 'BCC email addresses' },
          subject: { type: 'string', description: 'Message subject', optional: true },
          text: { type: 'string', description: 'Plain text content', optional: true },
          html: { type: 'string', description: 'HTML content', optional: true },
          createdAt: { type: 'string', description: 'Creation timestamp' },
        },
      },
    },
  },
}
