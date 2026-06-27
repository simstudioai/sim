import { WhatsAppIcon } from '@/components/icons'
import { WhatsAppBlockDisplay } from '@/blocks/blocks/whatsapp.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { WhatsAppResponse } from '@/tools/whatsapp/types'
import { getTrigger } from '@/triggers'

export const WhatsAppBlock: BlockConfig<WhatsAppResponse> = {
  ...WhatsAppBlockDisplay,
  authMode: AuthMode.ApiKey,
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

export const WhatsAppBlockMeta = {
  tags: ['messaging', 'automation'],
  url: 'https://www.whatsapp.com',
  templates: [
    {
      icon: WhatsAppIcon,
      title: 'WhatsApp appointment confirmations',
      prompt:
        'Build a workflow that reads upcoming Google Calendar appointments each morning and sends a WhatsApp confirmation with date, time, and a one-tap reschedule link.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['communication', 'automation'],
      alsoIntegrations: ['google_calendar'],
    },
    {
      icon: WhatsAppIcon,
      title: 'WhatsApp order tracking',
      prompt:
        'Create a workflow that watches Shopify shipment events and sends customers a WhatsApp message with the tracking number, ETA, and a follow-up review request after delivery.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['ecommerce', 'communication'],
      alsoIntegrations: ['shopify'],
    },
    {
      icon: WhatsAppIcon,
      title: 'WhatsApp customer support agent',
      prompt:
        'Build a WhatsApp business agent that answers customer questions using a knowledge base, hands off to a human in Zendesk on complex tickets, and writes the conversation back to the contact record.',
      modules: ['knowledge-base', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication'],
      alsoIntegrations: ['zendesk'],
    },
    {
      icon: WhatsAppIcon,
      title: 'WhatsApp lead qualifier',
      prompt:
        'Create a workflow that engages new leads via WhatsApp with a guided qualification script, scores them based on responses, and pushes qualified leads into Salesforce with the conversation log attached.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['sales', 'communication'],
      alsoIntegrations: ['salesforce'],
    },
    {
      icon: WhatsAppIcon,
      title: 'WhatsApp campaign sender',
      prompt:
        'Build a workflow that reads a segmented audience from a table and sends a personalized WhatsApp template message to each, throttling to stay under provider limits.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'communication'],
    },
    {
      icon: WhatsAppIcon,
      title: 'WhatsApp event RSVP collector',
      prompt:
        'Create a workflow that messages contacts about an upcoming event on WhatsApp, parses yes/no/maybe replies, and updates the RSVP table with the attendee count and dietary notes.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'communication'],
    },
    {
      icon: WhatsAppIcon,
      title: 'WhatsApp + Zoom meeting confirmer',
      prompt:
        'Build a workflow that sends a WhatsApp confirmation when a Zoom meeting is booked, with the join link and a one-tap reschedule option for the attendee.',
      modules: ['agent', 'workflows'],
      category: 'productivity',
      tags: ['communication', 'automation'],
      alsoIntegrations: ['zoom'],
    },
  ],
  skills: [
    {
      name: 'send-appointment-reminder',
      description:
        'Send a WhatsApp message reminding a contact of an upcoming appointment or booking.',
      content:
        '# Send a WhatsApp Appointment Reminder\n\nNotify a contact about an upcoming appointment over WhatsApp.\n\n## Steps\n1. Gather the recipient phone number in full international format (country code, no plus sign or spaces as the API expects).\n2. Compose a short, clear message with the date, time, location or link, and any action the contact should take.\n3. Send the message with the WhatsApp send operation.\n4. Capture the returned message ID and delivery state.\n\n## Output\nConfirm the recipient, the message sent, and the message ID. If the send was rejected, report the reason rather than retrying blindly.',
    },
    {
      name: 'send-order-update',
      description:
        'Notify a customer over WhatsApp about an order status change such as shipment or delivery.',
      content:
        '# Send a WhatsApp Order Update\n\nKeep a customer informed about their order via WhatsApp.\n\n## Steps\n1. Collect the customer phone number in full international format and the order details (number, status, tracking, ETA).\n2. Write a concise update that states what changed and includes the tracking link if available.\n3. Send the message and record the message ID and delivery state.\n\n## Output\nReport which customer was notified, the order referenced, and the message ID. Flag any number that could not be reached.',
    },
    {
      name: 'broadcast-to-segment',
      description:
        'Send a personalized WhatsApp message to each contact in an audience list, one at a time.',
      content:
        '# Broadcast a WhatsApp Message to a Segment\n\nDeliver a personalized message to every contact in a list.\n\n## Steps\n1. Read the audience list, each row holding a phone number and any personalization fields.\n2. For each contact, build the message by filling in their name and relevant details.\n3. Send messages one per contact, pacing them to stay within WhatsApp rate and template limits.\n4. Track which sends succeeded and which failed.\n\n## Output\nReturn counts of messages sent and failed, plus a short list of failed recipients with the failure reason.',
    },
  ],
} as const satisfies BlockMeta
