import { MailIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { MailSendResult } from '@/tools/mail/types'

export const MailBlock: BlockConfig<MailSendResult> = {
  type: 'mail',
  name: 'Mail',
  description: 'Send emails using the internal mail service',
  longDescription:
    'Send emails directly using the internal mail service. Uses MAIL_BLOCK_FROM_ADDRESS if configured, otherwise falls back to FROM_EMAIL_ADDRESS. No external configuration or OAuth required. Perfect for sending notifications, alerts, or general purpose emails from your workflows. Supports HTML formatting.',
  category: 'tools',
  bgColor: '#181C1E',
  icon: MailIcon,

  subBlocks: [
    {
      id: 'to',
      title: 'To',
      type: 'short-input',
      layout: 'full',
      placeholder: 'recipient@example.com',
      required: true,
    },
    {
      id: 'subject',
      title: 'Subject',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Email subject',
      required: true,
    },
    {
      id: 'body',
      title: 'Body',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Email body content (HTML supported)',
      required: true,
    },
  ],

  tools: {
    access: ['mail_send'],
    config: {
      tool: () => 'mail_send',
      params: (params) => ({
        to: params.to,
        subject: params.subject,
        body: params.body,
      }),
    },
  },

  inputs: {
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
    body: { type: 'string', description: 'Email body content' },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the email was sent successfully' },
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
    body: { type: 'string', description: 'Email body content' },
  },
}
