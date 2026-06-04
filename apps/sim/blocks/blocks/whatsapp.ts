import { WhatsAppIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { WhatsAppResponse } from '@/tools/whatsapp/types'
import { getTrigger } from '@/triggers'

export const WhatsAppBlock: BlockConfig<WhatsAppResponse> = {
  type: 'whatsapp',
  name: 'WhatsApp',
  description: 'Send WhatsApp messages',
  authMode: AuthMode.ApiKey,
  longDescription: 'Integrate WhatsApp into the workflow. Can send messages.',
  docsLink: 'https://docs.sim.ai/tools/whatsapp',
  category: 'tools',
  integrationType: IntegrationType.Communication,
  tags: ['messaging', 'automation'],
  bgColor: '#25D366',
  icon: WhatsAppIcon,
  triggerAllowed: true,
  subBlocks: [
    {
      id: 'phoneNumber',
      title: 'Recipient Phone Number',
      type: 'short-input',
      placeholder: 'Enter phone number with country code (e.g., +1234567890)',
      required: true,
    },
    {
      id: 'message',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Enter your message',
      required: true,
    },
    {
      id: 'previewUrl',
      title: 'Preview First Link',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      defaultValue: 'false',
      description:
        'Have WhatsApp attempt to render a link preview for the first URL in the message.',
      required: false,
      mode: 'advanced',
    },
    {
      id: 'phoneNumberId',
      title: 'WhatsApp Phone Number ID',
      type: 'short-input',
      placeholder: 'Your WhatsApp Business Phone Number ID',
      required: true,
    },
    {
      id: 'accessToken',
      title: 'Access Token',
      type: 'short-input',
      placeholder: 'Your WhatsApp Business API Access Token',
      password: true,
      required: true,
    },
    ...getTrigger('whatsapp_webhook').subBlocks,
  ],
  tools: {
    access: ['whatsapp_send_message'],
    config: {
      tool: () => 'whatsapp_send_message',
      params: (params) => ({
        ...params,
        previewUrl:
          params.previewUrl === 'true' ? true : params.previewUrl === 'false' ? false : undefined,
      }),
    },
  },
  inputs: {
    phoneNumber: { type: 'string', description: 'Recipient phone number' },
    message: { type: 'string', description: 'Message text' },
    previewUrl: { type: 'boolean', description: 'Whether to render a preview for the first URL' },
    phoneNumberId: { type: 'string', description: 'WhatsApp phone number ID' },
    accessToken: { type: 'string', description: 'WhatsApp access token' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Send success status' },
    messageId: { type: 'string', description: 'WhatsApp message identifier' },
    messageStatus: {
      type: 'string',
      description: 'Initial delivery state returned by the send API, such as accepted or paused',
    },
    messagingProduct: {
      type: 'string',
      description: 'Messaging product returned by the send API',
    },
    inputPhoneNumber: {
      type: 'string',
      description: 'Recipient phone number echoed by the send API',
    },
    whatsappUserId: {
      type: 'string',
      description: 'Resolved WhatsApp user ID for the recipient',
    },
    contacts: {
      type: 'array',
      description:
        'Recipient contacts returned by the send API (each item includes input and wa_id)',
    },
    eventType: {
      type: 'string',
      description: 'Webhook classification such as incoming_message, message_status, or mixed',
    },
    from: { type: 'string', description: 'Sender phone number from the first incoming message' },
    recipientId: {
      type: 'string',
      description: 'Recipient phone number from the first status update in the batch',
    },
    phoneNumberId: {
      type: 'string',
      description: 'Business phone number ID from the first message or status item in the batch',
    },
    displayPhoneNumber: {
      type: 'string',
      description:
        'Business display phone number from the first message or status item in the batch',
    },
    text: { type: 'string', description: 'Text body from the first incoming text message' },
    timestamp: {
      type: 'string',
      description: 'Timestamp from the first message or status item in the batch',
    },
    messageType: {
      type: 'string',
      description:
        'Type of the first incoming message in the batch, such as text, image, or system',
    },
    status: {
      type: 'string',
      description: 'First outgoing message status in the batch, such as sent, delivered, or read',
    },
    contact: {
      type: 'json',
      description: 'First sender contact in the webhook batch (wa_id, profile.name)',
    },
    messages: {
      type: 'json',
      description:
        'All incoming message objects from the webhook batch, flattened across entries/changes',
    },
    statuses: {
      type: 'json',
      description:
        'All message status objects from the webhook batch, flattened across entries/changes',
    },
    webhookContacts: {
      type: 'json',
      description: 'All sender contact profiles from the webhook batch',
    },
    conversation: {
      type: 'json',
      description:
        'Conversation metadata from the first status update in the batch (id, expiration_timestamp, origin.type)',
    },
    pricing: {
      type: 'json',
      description:
        'Pricing metadata from the first status update in the batch (billable, pricing_model, category)',
    },
    raw: {
      type: 'json',
      description: 'Full structured WhatsApp webhook payload',
    },
    error: { type: 'string', description: 'Error information if sending fails' },
  },
  triggers: {
    enabled: true,
    available: ['whatsapp_webhook'],
  },
}
