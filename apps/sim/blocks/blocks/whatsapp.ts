import { WhatsAppIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { WhatsAppResponse } from '@/tools/whatsapp/types'

export const WhatsAppBlock: BlockConfig<WhatsAppResponse> = {
  type: 'whatsapp',
  name: 'WhatsApp',
  description: 'Send WhatsApp messages',
  longDescription:
    'Send messages to WhatsApp users using the WhatsApp Business API. Requires WhatsApp Business API configuration.',
  docsLink: 'https://docs.sim.ai/tools/whatsapp',
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
      required: true,
    },
    {
      id: 'message',
      title: 'Message',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter your message',
      required: true,
    },
    {
      id: 'phoneNumberId',
      title: 'WhatsApp Phone Number ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your WhatsApp Business Phone Number ID',
      required: true,
    },
    {
      id: 'accessToken',
      title: 'Access Token',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Your WhatsApp Business API Access Token',
      password: true,
      required: true,
    },
  ],
  tools: {
    access: ['whatsapp_send_message'],
    config: {
      tool: () => 'whatsapp_send_message',
    },
  },
  inputs: {
    phoneNumber: { type: 'string', description: 'Recipient phone number' },
    message: { type: 'string', description: 'Message text' },
    phoneNumberId: { type: 'string', description: 'WhatsApp phone number ID' },
    accessToken: { type: 'string', description: 'WhatsApp access token' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Send success status' },
    messageId: { type: 'any', description: 'Message identifier' },
    error: { type: 'any', description: 'Error information' },
  },
}
