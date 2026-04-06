import type { GetDraftParams, GetDraftResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailGetDraftTool: ToolConfig<GetDraftParams, GetDraftResult> = {
  id: 'agentmail_get_draft',
  name: 'Get Draft',
  description: 'Get details of a specific email draft in AgentMail',
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
      description: 'ID of the inbox the draft belongs to',
    },
    draftId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the draft to retrieve',
    },
  },

  request: {
    url: (params) =>
      `https://api.agentmail.to/v0/inboxes/${params.inboxId.trim()}/drafts/${params.draftId.trim()}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<GetDraftResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? 'Failed to get draft',
        output: {
          draftId: '',
          inboxId: '',
          subject: null,
          to: [],
          cc: [],
          bcc: [],
          text: null,
          html: null,
          preview: null,
          labels: [],
          inReplyTo: null,
          sendStatus: null,
          sendAt: null,
          createdAt: '',
          updatedAt: '',
        },
      }
    }

    return {
      success: true,
      output: {
        draftId: data.draft_id ?? '',
        inboxId: data.inbox_id ?? '',
        subject: data.subject ?? null,
        to: data.to ?? [],
        cc: data.cc ?? [],
        bcc: data.bcc ?? [],
        text: data.text ?? null,
        html: data.html ?? null,
        preview: data.preview ?? null,
        labels: data.labels ?? [],
        inReplyTo: data.in_reply_to ?? null,
        sendStatus: data.send_status ?? null,
        sendAt: data.send_at ?? null,
        createdAt: data.created_at ?? '',
        updatedAt: data.updated_at ?? '',
      },
    }
  },

  outputs: {
    draftId: { type: 'string', description: 'Unique identifier for the draft' },
    inboxId: { type: 'string', description: 'Inbox the draft belongs to' },
    subject: { type: 'string', description: 'Draft subject', optional: true },
    to: { type: 'array', description: 'Recipient email addresses' },
    cc: { type: 'array', description: 'CC email addresses' },
    bcc: { type: 'array', description: 'BCC email addresses' },
    text: { type: 'string', description: 'Plain text content', optional: true },
    html: { type: 'string', description: 'HTML content', optional: true },
    preview: { type: 'string', description: 'Draft preview text', optional: true },
    labels: { type: 'array', description: 'Labels assigned to the draft' },
    inReplyTo: { type: 'string', description: 'Message ID this draft replies to', optional: true },
    sendStatus: {
      type: 'string',
      description: 'Send status (scheduled, sending, failed)',
      optional: true,
    },
    sendAt: { type: 'string', description: 'Scheduled send time', optional: true },
    createdAt: { type: 'string', description: 'Creation timestamp' },
    updatedAt: { type: 'string', description: 'Last updated timestamp' },
  },
}
