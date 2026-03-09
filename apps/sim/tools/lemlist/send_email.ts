import type { LemlistSendEmailParams, LemlistSendEmailResponse } from '@/tools/lemlist/types'
import type { ToolConfig } from '@/tools/types'

export const sendEmailTool: ToolConfig<LemlistSendEmailParams, LemlistSendEmailResponse> = {
  id: 'lemlist_send_email',
  name: 'Lemlist Send Email',
  description: 'Sends an email to a contact through the Lemlist inbox.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Lemlist API key',
    },
    sendUserId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identifier for the user sending the message (e.g., "usr_abc123def456")',
    },
    sendUserEmail: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email address of the sender (e.g., "sales@company.com")',
    },
    sendUserMailboxId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Mailbox identifier for the sender (e.g., "mbx_abc123def456")',
    },
    contactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recipient contact identifier (e.g., "con_abc123def456")',
    },
    leadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Associated lead identifier (e.g., "lea_abc123def456")',
    },
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email subject line',
    },
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email message body in HTML format',
    },
    cc: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of CC email addresses',
    },
  },

  request: {
    url: () => 'https://api.lemlist.com/api/inbox/email',
    method: 'POST',
    headers: (params) => {
      const credentials = Buffer.from(`:${params.apiKey}`).toString('base64')
      return {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => ({
      sendUserId: params.sendUserId?.trim(),
      sendUserEmail: params.sendUserEmail?.trim(),
      sendUserMailboxId: params.sendUserMailboxId?.trim(),
      contactId: params.contactId?.trim(),
      leadId: params.leadId?.trim(),
      subject: params.subject?.trim(),
      message: params.message,
      cc: params.cc ?? [],
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        ok: data.ok ?? true,
      },
    }
  },

  outputs: {
    ok: {
      type: 'boolean',
      description: 'Whether the email was sent successfully',
    },
  },
}
