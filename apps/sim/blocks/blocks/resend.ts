import { ResendIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { MailSendResult } from '@/tools/resend/types'

export const ResendBlock: BlockConfig<MailSendResult> = {
  type: 'resend',
  name: 'Resend',
  description: 'Send emails with Resend.',
  longDescription: 'Integrate Resend into the workflow. Can send emails. Requires API Key.',
  docsLink: 'https://docs.sim.ai/tools/resend',
  category: 'tools',
  bgColor: '#181C1E',
  icon: ResendIcon,

  subBlocks: [
    {
      id: 'fromAddress',
      title: 'From Address',
      type: 'short-input',
      layout: 'full',
      placeholder: 'sender@yourdomain.com',
      required: true,
    },
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
      placeholder: 'Email body content',
      required: true,
    },
    {
      id: 'resendApiKey',
      title: 'Resend API Key',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your Resend API key',
      required: true,
      password: true,
    },
  ],

  tools: {
    access: ['resend_send'],
    config: {
      tool: () => 'resend_send',
      params: (params) => ({
        resendApiKey: params.resendApiKey,
        fromAddress: params.fromAddress,
        to: params.to,
        subject: params.subject,
        body: params.body,
      }),
    },
  },

  inputs: {
    fromAddress: { type: 'string', description: 'Email address to send from' },
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
    body: { type: 'string', description: 'Email body content' },
    resendApiKey: { type: 'string', description: 'Resend API key for sending emails' },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the email was sent successfully' },
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
    body: { type: 'string', description: 'Email body content' },
  },
}
