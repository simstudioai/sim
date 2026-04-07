import type { CreateDraftParams, CreateDraftResult } from '@/tools/agentmail/types'
import type { ToolConfig } from '@/tools/types'

export const agentmailCreateDraftTool: ToolConfig<CreateDraftParams, CreateDraftResult> = {
  id: 'agentmail_create_draft',
  name: 'Create Draft',
  description: 'Create a new email draft in AgentMail',
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
      description: 'ID of the inbox to create the draft in',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Recipient email addresses (comma-separated)',
    },
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Draft subject line',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Plain text draft body',
    },
    html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTML draft body',
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
    inReplyTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of message being replied to',
    },
    sendAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 timestamp to schedule sending',
    },
  },

  request: {
    url: (params) => `https://api.agentmail.to/v0/inboxes/${params.inboxId.trim()}/drafts`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.to) body.to = params.to.split(',').map((e) => e.trim())
      if (params.subject) body.subject = params.subject
      if (params.text) body.text = params.text
      if (params.html) body.html = params.html
      if (params.cc) body.cc = params.cc.split(',').map((e) => e.trim())
      if (params.bcc) body.bcc = params.bcc.split(',').map((e) => e.trim())
      if (params.inReplyTo) body.in_reply_to = params.inReplyTo
      if (params.sendAt) body.send_at = params.sendAt
      return body
    },
  },

  transformResponse: async (response): Promise<CreateDraftResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.message ?? 'Failed to create draft',
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
