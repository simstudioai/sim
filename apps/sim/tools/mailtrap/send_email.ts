import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  MailtrapSendEmailParams,
  MailtrapSendEmailResult,
  MailtrapSendStream,
} from '@/tools/mailtrap/types'
import {
  parseAddress,
  parseAddressList,
  parseJsonRecord,
  readJsonBody,
} from '@/tools/mailtrap/utils'
import type { ToolConfig } from '@/tools/types'

const SEND_HOSTS = {
  transactional: 'https://send.api.mailtrap.io',
  bulk: 'https://bulk.api.mailtrap.io',
  sandbox: 'https://sandbox.api.mailtrap.io',
} as const

function isSendStream(value: string): value is MailtrapSendStream {
  return Object.hasOwn(SEND_HOSTS, value)
}

/**
 * Builds the send endpoint for the requested stream. The sandbox stream is
 * scoped to a specific sandbox, so a `sandboxId` is required in that mode.
 */
function resolveSendUrl(params: MailtrapSendEmailParams): string {
  const stream = params.stream?.trim() || 'transactional'
  if (!isSendStream(stream)) {
    throw new Error(`Invalid stream "${stream}". Use "transactional", "bulk", or "sandbox".`)
  }

  if (stream === 'sandbox') {
    const sandboxId = params.sandboxId?.trim()
    if (!sandboxId) {
      throw new Error('sandboxId is required when sending through the sandbox stream')
    }
    return `${SEND_HOSTS.sandbox}/api/send/${encodeURIComponent(sandboxId)}`
  }

  return `${SEND_HOSTS[stream]}/api/send`
}

export const mailtrapSendEmailTool: ToolConfig<MailtrapSendEmailParams, MailtrapSendEmailResult> = {
  id: 'mailtrap_send_email',
  name: 'Mailtrap Send Email',
  description:
    'Send an email through Mailtrap using the transactional, bulk, or sandbox (testing) stream. Supports plain text, HTML, and stored template bodies.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.MAILTRAP_ERRORS,

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mailtrap API token with sending permissions for the selected stream',
    },
    stream: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sending stream: "transactional" (default), "bulk", or "sandbox"',
    },
    sandboxId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sandbox id. Required when stream is "sandbox"',
    },
    from: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Sender address, either "sender@example.com" or "Sender Name <sender@example.com>". Must belong to a verified sending domain',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Recipient address(es), up to 1000. Comma-separated, each either "user@example.com" or "Name <user@example.com>". At least one recipient across to, cc, or bcc is required',
    },
    cc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'CC address(es), up to 1000. Comma-separated, each "user@example.com" or "Name <user@example.com>"',
    },
    bcc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'BCC address(es), up to 1000. Comma-separated, each "user@example.com" or "Name <user@example.com>"',
    },
    replyTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reply-To address, either "user@example.com" or "Name <user@example.com>"',
    },
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Email subject line (non-empty). When a template is used, this overrides the template subject',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Plain text body',
    },
    html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTML body',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Category label used for grouping and analytics in Mailtrap (max 255 characters)',
    },
    customVariables: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Object of string key-value pairs attached to the message as custom variables',
    },
    emailHeaders: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Object of additional SMTP headers to attach to the message',
    },
    templateUuid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'UUID of a Mailtrap email template to render instead of text/html',
    },
    templateVariables: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Object of variables passed to the selected template',
    },
  },

  request: {
    url: (params) => resolveSendUrl(params),
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiToken}`,
    }),
    body: (params) => {
      // The Mailtrap send body is a oneOf: a message must carry a text body, an
      // html body, or a stored template.
      if (!params.subject?.trim()) {
        throw new Error('subject is required and must not be empty')
      }
      if (!params.text?.trim() && !params.html?.trim() && !params.templateUuid?.trim()) {
        throw new Error('provide a text body, an html body, or a templateUuid')
      }

      const from = parseAddress(params.from)
      if (!from?.email) {
        throw new Error('from is required (an email address, optionally "Name <email>")')
      }

      const to = parseAddressList(params.to)
      const cc = parseAddressList(params.cc)
      const bcc = parseAddressList(params.bcc)
      if (to.length === 0 && cc.length === 0 && bcc.length === 0) {
        throw new Error('provide at least one recipient in to, cc, or bcc')
      }

      const body: Record<string, unknown> = { from }
      if (to.length > 0) body.to = to
      if (cc.length > 0) body.cc = cc
      if (bcc.length > 0) body.bcc = bcc

      const replyTo = parseAddress(params.replyTo)
      if (replyTo) body.reply_to = replyTo
      if (params.subject) body.subject = params.subject
      if (params.text) body.text = params.text
      if (params.html) body.html = params.html
      if (params.category?.trim()) body.category = params.category.trim()

      const customVariables = parseJsonRecord(params.customVariables, 'customVariables')
      if (customVariables) body.custom_variables = customVariables

      const emailHeaders = parseJsonRecord(params.emailHeaders, 'emailHeaders')
      if (emailHeaders) body.headers = emailHeaders

      if (params.templateUuid?.trim()) {
        body.template_uuid = params.templateUuid.trim()
        const templateVariables = parseJsonRecord(params.templateVariables, 'templateVariables')
        if (templateVariables) body.template_variables = templateVariables
      }

      return body
    },
  },

  transformResponse: async (response): Promise<MailtrapSendEmailResult> => {
    const data = await readJsonBody(response)

    // Mailtrap returns 2xx with `{ success: false, errors: [...] }` for a
    // rejected send.
    if (data.success !== true) {
      const detail = Array.isArray(data.errors) ? `: ${data.errors.join('; ')}` : ''
      throw new Error(`Mailtrap did not confirm the send${detail}`)
    }

    const messageIds = Array.isArray(data.message_ids)
      ? data.message_ids.filter((id): id is string => typeof id === 'string')
      : []

    return {
      success: true,
      output: {
        success: true,
        messageIds,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether Mailtrap accepted the message' },
    messageIds: {
      type: 'array',
      description: 'Message ids assigned by Mailtrap, one per recipient',
      items: { type: 'string' },
    },
  },
}
