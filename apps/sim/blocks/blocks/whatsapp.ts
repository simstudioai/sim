import { WhatsAppIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { WhatsAppResponse } from '@/tools/whatsapp/types'

export const WhatsAppBlock: BlockConfig<WhatsAppResponse> = {
  type: 'whatsapp',
  name: 'WhatsApp',
  description: 'Send WhatsApp messages',
  longDescription:
    'Send messages to WhatsApp users using the WhatsApp Business API. Requires WhatsApp Business API configuration.',
  docsLink: 'https://docs.simstudio.ai/tools/whatsapp',
  category: 'tools',
  bgColor: '#25D366',
  icon: WhatsAppIcon,
  subBlocks: [
    {
      id: 'phoneNumber',
      title: 'Recipient Phone Number',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter phone number with country code (e.g., +1234567890)',
    },
    {
      id: 'message',
      title: 'Message',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter your message',
    },
    {
      id: 'phoneNumberId',
      title: 'WhatsApp Phone Number ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your WhatsApp Business Phone Number ID',
    },
    {
      id: 'accessToken',
      title: 'Access Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your WhatsApp Business API Access Token',
      password: true,
    },
  ],
  tools: {
    access: ['whatsapp_send_message'],
    config: {
      tool: () => 'whatsapp_send_message',
    },
  },
  inputs: {
    phoneNumber: { type: 'string', required: true },
    message: { type: 'string', required: true },
    phoneNumberId: { type: 'string', required: true },
    accessToken: { type: 'string', required: true },
  },
  outputs: {
    success: 'boolean',
    messageId: 'any',
    error: 'any',
  },
}
