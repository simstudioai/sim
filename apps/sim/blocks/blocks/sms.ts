import { SMSIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { SMSSendResult } from '@/tools/sms/types'

export const SMSBlock: BlockConfig<SMSSendResult> = {
  type: 'sms',
  name: 'SMS',
  description: 'Send SMS messages using the internal SMS service',
  longDescription:
    'Send SMS messages directly using the internal SMS service powered by Twilio. No external configuration or OAuth required. Perfect for sending notifications, alerts, or general purpose text messages from your workflows. Requires valid phone numbers with country codes.',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: SMSIcon,

  subBlocks: [
    {
      id: 'to',
      title: 'To',
      type: 'short-input',
      layout: 'full',
      placeholder: '+1234567890',
      required: true,
    },
    {
      id: 'body',
      title: 'Message',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Your SMS message content...',
      required: true,
    },
  ],

  tools: {
    access: ['sms_send'],
    config: {
      tool: () => 'sms_send',
      params: (params) => ({
        to: params.to,
        body: params.body,
      }),
    },
  },

  inputs: {
    to: { type: 'string', description: 'Recipient phone number (include country code)' },
    body: { type: 'string', description: 'SMS message content' },
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the SMS was sent successfully' },
    to: { type: 'string', description: 'Recipient phone number' },
    body: { type: 'string', description: 'SMS message content' },
  },
}
