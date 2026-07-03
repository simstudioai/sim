import { WhatsAppIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { WhatsAppResponse } from '@/tools/whatsapp/types'
import { getTrigger } from '@/triggers'

export const WhatsAppBlock: BlockConfig<WhatsAppResponse> = {
  type: 'whatsapp',
  name: 'WhatsApp',
  description: 'Send WhatsApp messages',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate WhatsApp into the workflow. Send text, template, media, and interactive messages, react to messages, and mark messages as read through the WhatsApp Cloud API.',
  docsLink: 'https://docs.sim.ai/integrations/whatsapp',
  category: 'tools',
  integrationType: IntegrationType.Communication,
  bgColor: '#25D366',
  iconColor: '#25D366',
  icon: WhatsAppIcon,
  triggerAllowed: true,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Message', id: 'send_message' },
        { label: 'Send Template', id: 'send_template' },
        { label: 'Send Media', id: 'send_media' },
        { label: 'Send Interactive', id: 'send_interactive' },
        { label: 'Send Reaction', id: 'send_reaction' },
        { label: 'Mark As Read', id: 'mark_read' },
      ],
      defaultValue: 'send_message',
    },
    {
      id: 'phoneNumber',
      title: 'Recipient Phone Number',
      type: 'short-input',
      placeholder: 'Enter phone number with country code (e.g., +1234567890)',
      condition: { field: 'operation', value: 'mark_read', not: true },
      required: { field: 'operation', value: 'mark_read', not: true },
    },
    {
      id: 'message',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Enter your message',
      condition: { field: 'operation', value: 'send_message' },
      required: { field: 'operation', value: 'send_message' },
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
      condition: { field: 'operation', value: 'send_message' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'templateName',
      title: 'Template Name',
      type: 'short-input',
      placeholder: 'Name of the approved template',
      condition: { field: 'operation', value: 'send_template' },
      required: { field: 'operation', value: 'send_template' },
    },
    {
      id: 'languageCode',
      title: 'Template Language',
      type: 'short-input',
      placeholder: 'e.g., en_US',
      defaultValue: 'en_US',
      condition: { field: 'operation', value: 'send_template' },
      required: { field: 'operation', value: 'send_template' },
    },
    {
      id: 'components',
      title: 'Template Components',
      type: 'long-input',
      placeholder: '[{"type":"body","parameters":[{"type":"text","text":"value"}]}]',
      description: 'JSON array of template components with variable parameters.',
      condition: { field: 'operation', value: 'send_template' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'mediaType',
      title: 'Media Type',
      type: 'dropdown',
      options: [
        { label: 'Image', id: 'image' },
        { label: 'Document', id: 'document' },
        { label: 'Video', id: 'video' },
        { label: 'Audio', id: 'audio' },
      ],
      defaultValue: 'image',
      condition: { field: 'operation', value: 'send_media' },
      required: { field: 'operation', value: 'send_media' },
    },
    {
      id: 'mediaLink',
      title: 'Media Link',
      type: 'short-input',
      placeholder: 'Public HTTPS URL of the media',
      condition: { field: 'operation', value: 'send_media' },
      required: false,
    },
    {
      id: 'mediaId',
      title: 'Media ID',
      type: 'short-input',
      placeholder: 'ID of media uploaded to WhatsApp',
      description: 'Provide a Media Link or a Media ID.',
      condition: { field: 'operation', value: 'send_media' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'caption',
      title: 'Caption',
      type: 'long-input',
      placeholder: 'Optional caption (image, video, or document)',
      condition: { field: 'operation', value: 'send_media' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'filename',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Optional file name for documents',
      condition: { field: 'operation', value: 'send_media' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'bodyText',
      title: 'Body Text',
      type: 'long-input',
      placeholder: 'Main message body',
      condition: { field: 'operation', value: 'send_interactive' },
      required: { field: 'operation', value: 'send_interactive' },
    },
    {
      id: 'buttons',
      title: 'Reply Buttons',
      type: 'long-input',
      placeholder: '[{"type":"reply","reply":{"id":"yes","title":"Yes"}}]',
      description: 'JSON array of reply buttons (max 3). Provide buttons or sections.',
      condition: { field: 'operation', value: 'send_interactive' },
      required: false,
    },
    {
      id: 'listButtonText',
      title: 'List Button Text',
      type: 'short-input',
      placeholder: 'e.g., Menu',
      description: 'Label for the button that opens the list. Required when sending a list.',
      condition: { field: 'operation', value: 'send_interactive' },
      required: false,
    },
    {
      id: 'sections',
      title: 'List Sections',
      type: 'long-input',
      placeholder: '[{"title":"Section","rows":[{"id":"r1","title":"Row 1"}]}]',
      description: 'JSON array of list sections. Provide sections or buttons.',
      condition: { field: 'operation', value: 'send_interactive' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'headerText',
      title: 'Header Text',
      type: 'short-input',
      placeholder: 'Optional plain-text header',
      condition: { field: 'operation', value: 'send_interactive' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'footerText',
      title: 'Footer Text',
      type: 'short-input',
      placeholder: 'Optional footer text',
      condition: { field: 'operation', value: 'send_interactive' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'wamid of the target message',
      condition: { field: 'operation', value: ['send_reaction', 'mark_read'] },
      required: { field: 'operation', value: ['send_reaction', 'mark_read'] },
    },
    {
      id: 'emoji',
      title: 'Emoji',
      type: 'short-input',
      placeholder: 'e.g., 👍 (leave empty to remove a reaction)',
      condition: { field: 'operation', value: 'send_reaction' },
      required: false,
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
    access: [
      'whatsapp_send_message',
      'whatsapp_send_template',
      'whatsapp_send_media',
      'whatsapp_send_interactive',
      'whatsapp_send_reaction',
      'whatsapp_mark_read',
    ],
    config: {
      tool: (params) => `whatsapp_${params.operation || 'send_message'}`,
      params: (params) => ({
        ...params,
        previewUrl:
          params.previewUrl === 'true' ? true : params.previewUrl === 'false' ? false : undefined,
      }),
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    phoneNumber: { type: 'string', description: 'Recipient phone number' },
    message: { type: 'string', description: 'Message text' },
    previewUrl: { type: 'boolean', description: 'Whether to render a preview for the first URL' },
    templateName: { type: 'string', description: 'Approved template name' },
    languageCode: { type: 'string', description: 'Template language code (e.g., en_US)' },
    components: { type: 'json', description: 'Template components with variable parameters' },
    mediaType: { type: 'string', description: 'Media type: image, document, video, or audio' },
    mediaLink: { type: 'string', description: 'Public HTTPS URL of the media' },
    mediaId: { type: 'string', description: 'ID of media uploaded to WhatsApp' },
    caption: { type: 'string', description: 'Caption for image, video, or document media' },
    filename: { type: 'string', description: 'File name for document media' },
    bodyText: { type: 'string', description: 'Interactive message body text' },
    headerText: { type: 'string', description: 'Interactive message header text' },
    footerText: { type: 'string', description: 'Interactive message footer text' },
    buttons: { type: 'json', description: 'Reply buttons for an interactive message' },
    listButtonText: { type: 'string', description: 'Label for the list menu button' },
    sections: { type: 'json', description: 'List sections for an interactive message' },
    messageId: { type: 'string', description: 'Target message ID (wamid)' },
    emoji: { type: 'string', description: 'Reaction emoji (empty to remove)' },
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
  tags: ['messaging', 'automation', 'customer-support', 'marketing'],
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
