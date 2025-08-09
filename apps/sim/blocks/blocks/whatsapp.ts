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
    // Send operation outputs
    success: { type: 'boolean', description: 'Send success status' },
    messageId: { type: 'string', description: 'WhatsApp message identifier' },
    error: { type: 'string', description: 'Error information if sending fails' },
    // Webhook trigger outputs
    from: { type: 'string', description: 'Sender phone number' },
    to: { type: 'string', description: 'Recipient phone number' },
    text: { type: 'string', description: 'Message text content' },
    timestamp: { type: 'string', description: 'Message timestamp' },
    type: { type: 'string', description: 'Message type (text, image, etc.)' },
  },
  triggers: {
    enabled: true,
    available: ['whatsapp_webhook'],
  },
}
