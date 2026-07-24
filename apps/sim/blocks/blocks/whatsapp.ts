import { WhatsAppIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { WhatsAppResponse } from '@/tools/whatsapp/types'
import { getTrigger } from '@/triggers'

/** Yes/No dropdowns serialize as `'true'`/`'false'` strings; the tools expect booleans. */
function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return undefined
}

export const WhatsAppBlock: BlockConfig<WhatsAppResponse> = {
  type: 'whatsapp',
  name: 'WhatsApp',
  description: 'Send WhatsApp messages',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate WhatsApp into the workflow. Send text, template, media, and interactive messages, react to messages, and mark messages as read through the WhatsApp Cloud API. Free-form messages only reach a recipient within 24 hours of their last message to you — outside that window WhatsApp requires a pre-approved template.',
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
        { label: 'Upload Media', id: 'upload_media' },
        { label: 'Download Media', id: 'get_media' },
      ],
      defaultValue: 'send_message',
    },
    {
      id: 'phoneNumber',
      title: 'Recipient Phone Number',
      type: 'short-input',
      placeholder: 'Enter phone number with country code (e.g., +1234567890)',
      description: 'Include the plus sign and country calling code.',
      condition: {
        field: 'operation',
        value: ['mark_read', 'upload_media', 'get_media'],
        not: true,
      },
      required: {
        field: 'operation',
        value: ['mark_read', 'upload_media', 'get_media'],
        not: true,
      },
    },
    {
      id: 'message',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Enter your message',
      description:
        'Free-form text (max 4096 characters). WhatsApp only delivers this within 24 hours of the recipient last messaging you — outside that window use Send Template.',
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
      wandConfig: {
        enabled: true,
        prompt: `Generate a WhatsApp template components JSON array based on the user's description.
Each component fills the variables of one part of an approved template.

Current components: {context}

Format:
[
  {
    "type": "header",
    "parameters": [{ "type": "text", "text": "value" }]
  },
  {
    "type": "body",
    "parameters": [
      { "type": "text", "text": "value" },
      { "type": "currency", "currency": { "fallback_value": "$100", "code": "USD", "amount_1000": 100000 } },
      { "type": "date_time", "date_time": { "fallback_value": "February 25, 2026" } }
    ]
  },
  {
    "type": "button",
    "sub_type": "url",
    "index": "0",
    "parameters": [{ "type": "text", "text": "suffix" }]
  }
]

RULES:
1. Parameters are positional - they fill {{1}}, {{2}}, ... in template order
2. Only include the components the template actually declares
3. "button" components require both "sub_type" and a string "index"

Return ONLY the valid JSON array - no explanations, no extra text.`,
        placeholder: 'Describe the template variables to fill...',
        generationType: 'json-object',
      },
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
        { label: 'Sticker', id: 'sticker' },
      ],
      defaultValue: 'image',
      condition: { field: 'operation', value: 'send_media' },
      required: { field: 'operation', value: 'send_media' },
    },
    {
      id: 'sendMediaFile',
      title: 'Media',
      type: 'file-upload',
      canonicalParamId: 'mediaSource',
      placeholder: 'Upload media to send',
      description:
        'Uploaded to WhatsApp, then sent. Use Upload Media when sending the same file repeatedly.',
      mode: 'basic',
      multiple: false,
      required: false,
      acceptedTypes:
        '.jpg,.jpeg,.png,.webp,.mp4,.3gp,.aac,.amr,.mp3,.m4a,.ogg,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt',
      condition: { field: 'operation', value: 'send_media' },
    },
    {
      id: 'sendMediaFileRef',
      title: 'Media',
      type: 'short-input',
      canonicalParamId: 'mediaSource',
      placeholder: 'Reference a file from a previous block',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: 'send_media' },
    },
    {
      id: 'mediaId',
      title: 'Media ID',
      type: 'short-input',
      placeholder: 'ID of media already uploaded to WhatsApp',
      description: 'Alternative to Media. Reuses an upload for 30 days.',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: 'send_media' },
    },
    {
      id: 'mediaLink',
      title: 'Media Link',
      type: 'short-input',
      placeholder: 'Public HTTPS URL of the media',
      description: 'Alternative to Media. WhatsApp fetches and caches this URL for 10 minutes.',
      mode: 'advanced',
      required: false,
      condition: { field: 'operation', value: 'send_media' },
    },
    {
      id: 'caption',
      title: 'Caption',
      type: 'long-input',
      placeholder: 'Optional caption (image, video, or document)',
      description: 'Max 1024 characters. Not supported for audio or sticker media.',
      condition: {
        field: 'operation',
        value: 'send_media',
        and: { field: 'mediaType', value: ['image', 'video', 'document'] },
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'filename',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Optional file name for documents',
      condition: {
        field: 'operation',
        value: 'send_media',
        and: { field: 'mediaType', value: 'document' },
      },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'interactiveType',
      title: 'Interactive Type',
      type: 'dropdown',
      options: [
        { label: 'Reply Buttons', id: 'button' },
        { label: 'List', id: 'list' },
      ],
      defaultValue: 'button',
      condition: { field: 'operation', value: 'send_interactive' },
      required: { field: 'operation', value: 'send_interactive' },
    },
    {
      id: 'bodyText',
      title: 'Body Text',
      type: 'long-input',
      placeholder: 'Main message body',
      description: 'Max 1024 characters with reply buttons, 4096 with a list.',
      condition: { field: 'operation', value: 'send_interactive' },
      required: { field: 'operation', value: 'send_interactive' },
    },
    {
      id: 'buttons',
      title: 'Reply Buttons',
      type: 'long-input',
      placeholder: '[{"type":"reply","reply":{"id":"yes","title":"Yes"}}]',
      description: 'JSON array of reply buttons (max 3, title max 20 characters).',
      condition: {
        field: 'operation',
        value: 'send_interactive',
        and: { field: 'interactiveType', value: 'button' },
      },
      required: {
        field: 'operation',
        value: 'send_interactive',
        and: { field: 'interactiveType', value: 'button' },
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a WhatsApp interactive reply buttons JSON array based on the user's description.

Current buttons: {context}

Format:
[
  { "type": "reply", "reply": { "id": "unique_id", "title": "Button Label" } }
]

RULES:
1. Maximum 3 buttons
2. "title" must be 20 characters or fewer and must be unique across the buttons
3. "id" must be unique, 256 characters or fewer, and is what the webhook reports back when tapped

Return ONLY the valid JSON array - no explanations, no extra text.`,
        placeholder: 'Describe the reply buttons to offer...',
        generationType: 'json-object',
      },
    },
    {
      id: 'listButtonText',
      title: 'List Button Text',
      type: 'short-input',
      placeholder: 'e.g., Menu',
      description: 'Label for the button that opens the list (max 20 characters).',
      condition: {
        field: 'operation',
        value: 'send_interactive',
        and: { field: 'interactiveType', value: 'list' },
      },
      required: {
        field: 'operation',
        value: 'send_interactive',
        and: { field: 'interactiveType', value: 'list' },
      },
    },
    {
      id: 'sections',
      title: 'List Sections',
      type: 'long-input',
      placeholder: '[{"title":"Section","rows":[{"id":"r1","title":"Row 1"}]}]',
      description: 'JSON array of list sections (max 10 sections, 10 rows total).',
      condition: {
        field: 'operation',
        value: 'send_interactive',
        and: { field: 'interactiveType', value: 'list' },
      },
      required: {
        field: 'operation',
        value: 'send_interactive',
        and: { field: 'interactiveType', value: 'list' },
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate a WhatsApp interactive list sections JSON array based on the user's description.

Current sections: {context}

Format:
[
  {
    "title": "Section Title",
    "rows": [
      { "id": "unique_id", "title": "Row Title", "description": "Optional detail" }
    ]
  }
]

RULES:
1. Maximum 10 sections and 10 rows total across all sections
2. Section "title" and row "title" must be 24 characters or fewer
3. Row "description" is optional and must be 72 characters or fewer
4. Row "id" must be unique across all sections, 200 characters or fewer, and is what the webhook reports back when selected

Return ONLY the valid JSON array - no explanations, no extra text.`,
        placeholder: 'Describe the list options to offer...',
        generationType: 'json-object',
      },
    },
    {
      id: 'headerText',
      title: 'Header Text',
      type: 'short-input',
      placeholder: 'Optional plain-text header',
      description: 'Max 60 characters.',
      condition: { field: 'operation', value: 'send_interactive' },
      required: false,
      mode: 'advanced',
    },
    {
      id: 'footerText',
      title: 'Footer Text',
      type: 'short-input',
      placeholder: 'Optional footer text',
      description: 'Max 60 characters.',
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
      id: 'uploadFile',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload a file',
      description:
        'WhatsApp limits: images 5 MB, video and audio 16 MB, documents 100 MB, stickers 500 KB.',
      mode: 'basic',
      multiple: false,
      required: true,
      acceptedTypes:
        '.jpg,.jpeg,.png,.webp,.mp4,.3gp,.aac,.amr,.mp3,.m4a,.ogg,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt',
      condition: { field: 'operation', value: 'upload_media' },
    },
    {
      id: 'uploadFileRef',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference a file from a previous block',
      mode: 'advanced',
      required: true,
      condition: { field: 'operation', value: 'upload_media' },
    },
    {
      id: 'downloadMediaId',
      title: 'Media ID',
      type: 'short-input',
      placeholder: 'Media ID from an incoming message',
      description:
        'The media asset ID on an incoming message, not the message ID (wamid). Incoming media IDs expire after 7 days.',
      condition: { field: 'operation', value: 'get_media' },
      required: { field: 'operation', value: 'get_media' },
    },
    {
      id: 'showTypingIndicator',
      title: 'Show Typing Indicator',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      defaultValue: 'false',
      description:
        'Display a typing indicator to the sender. Dismissed once you reply or after 25 seconds.',
      condition: { field: 'operation', value: 'mark_read' },
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
    access: [
      'whatsapp_send_message',
      'whatsapp_send_template',
      'whatsapp_send_media',
      'whatsapp_send_interactive',
      'whatsapp_send_reaction',
      'whatsapp_mark_read',
      'whatsapp_upload_media',
      'whatsapp_get_media',
    ],
    config: {
      tool: (params) => `whatsapp_${params.operation || 'send_message'}`,
      params: (params) => {
        const {
          interactiveType,
          file: uploadedFile,
          mediaSource,
          downloadMediaId,
          ...rest
        } = params
        // Both file canonical pairs resolve to the tool's single `file` param; only one
        // operation is ever active, so they cannot collide.
        const file = normalizeFileInput(uploadedFile ?? mediaSource, { single: true })

        return {
          ...rest,
          previewUrl: toOptionalBoolean(params.previewUrl),
          showTypingIndicator: toOptionalBoolean(params.showTypingIndicator),
          ...(file ? { file } : {}),
          ...(params.operation === 'get_media' ? { mediaId: downloadMediaId } : {}),
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    phoneNumber: { type: 'string', description: 'Recipient phone number' },
    message: { type: 'string', description: 'Message text' },
    previewUrl: { type: 'string', description: 'Whether to render a preview for the first URL' },
    templateName: { type: 'string', description: 'Approved template name' },
    languageCode: { type: 'string', description: 'Template language code (e.g., en_US)' },
    components: { type: 'json', description: 'Template components with variable parameters' },
    mediaType: {
      type: 'string',
      description: 'Media type: image, document, video, audio, or sticker',
    },
    mediaSource: { type: 'json', description: 'Media file to send' },
    mediaId: { type: 'string', description: 'ID of media already uploaded to WhatsApp' },
    mediaLink: { type: 'string', description: 'Public HTTPS URL of the media' },
    caption: { type: 'string', description: 'Caption for image, video, or document media' },
    filename: { type: 'string', description: 'File name for document media' },
    interactiveType: {
      type: 'string',
      description: 'Interactive message variant: button or list',
    },
    bodyText: { type: 'string', description: 'Interactive message body text' },
    headerText: { type: 'string', description: 'Interactive message header text' },
    footerText: { type: 'string', description: 'Interactive message footer text' },
    buttons: { type: 'json', description: 'Reply buttons for an interactive message' },
    listButtonText: { type: 'string', description: 'Label for the list menu button' },
    sections: { type: 'json', description: 'List sections for an interactive message' },
    messageId: { type: 'string', description: 'Target message ID (wamid)' },
    emoji: { type: 'string', description: 'Reaction emoji (empty to remove)' },
    showTypingIndicator: {
      type: 'string',
      description: 'Whether to show a typing indicator when marking a message as read',
    },
    file: { type: 'json', description: 'File to upload to WhatsApp' },
    downloadMediaId: { type: 'string', description: 'Media asset ID to download' },
    phoneNumberId: { type: 'string', description: 'WhatsApp phone number ID' },
    accessToken: { type: 'string', description: 'WhatsApp access token' },
  },
  outputs: {
    success: { type: 'boolean', description: 'Send success status' },
    messageId: { type: 'string', description: 'WhatsApp message identifier' },
    messageStatus: {
      type: 'string',
      description:
        'Pacing status from the send API: accepted, held_for_quality_assessment, or paused. Acceptance is not delivery — use the webhook trigger for delivery status.',
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
    mediaId: {
      type: 'string',
      description: 'Media asset ID from Upload Media, or the ID downloaded by Download Media',
    },
    file: {
      type: 'file',
      description: 'Media downloaded by Download Media, stored as a workflow file',
    },
    fileName: { type: 'string', description: 'Name of the file uploaded by Upload Media' },
    mimeType: { type: 'string', description: 'MIME type of the uploaded or downloaded media' },
    size: { type: 'number', description: 'Size in bytes of the file uploaded by Upload Media' },
    fileSize: { type: 'number', description: 'Size in bytes of the downloaded media' },
    sha256: {
      type: 'string',
      description: 'SHA-256 hash WhatsApp reported for the downloaded media',
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
    mediaMimeType: {
      type: 'string',
      description: 'MIME type of the first incoming media message in the webhook batch',
    },
    caption: {
      type: 'string',
      description: 'Caption on the first incoming image, video, or document message',
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
        'Send a WhatsApp template message reminding a contact of an upcoming appointment or booking.',
      content:
        '# Send a WhatsApp Appointment Reminder\n\nNotify a contact about an upcoming appointment over WhatsApp.\n\nA reminder is business-initiated, so it almost always falls outside the 24-hour customer service window. Use the Send Template operation with a pre-approved template — a free-form text message will be rejected unless the contact messaged you within the last 24 hours.\n\n## Steps\n1. Gather the recipient phone number with the plus sign and country calling code (e.g. +14155552671).\n2. Pick the approved appointment-reminder template and its language code (e.g. en_US).\n3. Fill the template components positionally — the parameters map to {{1}}, {{2}}, ... in the order the template declares them (date, time, location or link).\n4. Send with Send Template and capture the returned message ID.\n\n## Output\nConfirm the recipient, the template used, and the message ID. If the send was rejected, report the WhatsApp error code and message rather than retrying blindly — a template rejection usually means the template name, language, or parameter count is wrong.',
    },
    {
      name: 'send-order-update',
      description:
        'Notify a customer over WhatsApp about an order status change such as shipment or delivery.',
      content:
        '# Send a WhatsApp Order Update\n\nKeep a customer informed about their order via WhatsApp.\n\n## Steps\n1. Collect the customer phone number with the plus sign and country calling code, plus the order details (number, status, tracking, ETA).\n2. Choose the operation by conversation state: if the customer messaged you within the last 24 hours, Send Message works; otherwise use Send Template with an approved shipping-update template.\n3. State what changed and include the tracking link if available.\n4. Send and record the message ID.\n\n## Output\nReport which customer was notified, the order referenced, and the message ID. Flag any number that could not be reached, including the WhatsApp error code.',
    },
    {
      name: 'broadcast-to-segment',
      description:
        'Send a personalized WhatsApp template message to each contact in an audience list, one at a time.',
      content:
        "# Broadcast a WhatsApp Message to a Segment\n\nDeliver a personalized message to every contact in a list.\n\nBroadcasts are business-initiated, so every send must use the Send Template operation with a pre-approved marketing or utility template. Free-form text will fail for any contact who has not messaged you in the last 24 hours.\n\n## Steps\n1. Read the audience list, each row holding a phone number and any personalization fields.\n2. For each contact, build the template components by filling the positional parameters with that row's values.\n3. Send one template message per contact, pacing them to stay within the account throughput limit.\n4. Track which sends succeeded and which failed.\n\n## Output\nReturn counts of messages sent and failed, plus a short list of failed recipients with the WhatsApp error code for each.",
    },
    {
      name: 'send-interactive-menu',
      description:
        'Ask a WhatsApp contact to choose from reply buttons or a selectable list, then act on the reply.',
      content:
        '# Send a WhatsApp Interactive Menu\n\nOffer a contact a set of tappable choices instead of asking them to type a reply.\n\n## Steps\n1. Decide the variant: reply buttons for up to 3 short choices, a list for up to 10 options grouped into sections.\n2. Write the body text and give every choice a stable id — the webhook reports that id back when the contact taps it, so it is what your workflow branches on.\n3. Respect the limits: button titles 20 characters, list row titles 24, row descriptions 72, list menu button 20.\n4. Send with Send Interactive and record the message ID.\n5. Handle the reply in a workflow triggered by the WhatsApp webhook, matching on the returned id.\n\n## Output\nConfirm the choices offered and the message ID. When a reply arrives, report which option the contact selected.',
    },
    {
      name: 'acknowledge-incoming-message',
      description:
        'Mark an incoming WhatsApp message as read, show a typing indicator, and react to it.',
      content:
        '# Acknowledge an Incoming WhatsApp Message\n\nGive a contact immediate feedback that their message landed while a longer reply is being prepared.\n\n## Steps\n1. Take the message ID (wamid) from the WhatsApp webhook trigger payload.\n2. Call Mark As Read with that message ID so the sender sees blue checkmarks. Enable the typing indicator when a reply is coming — it clears once you respond or after 25 seconds.\n3. Optionally use Send Reaction with an emoji to acknowledge the message inline. Reactions are not delivered for messages over 30 days old, deleted messages, or other reactions.\n4. Send the substantive reply with Send Message — the incoming message opened the 24-hour window, so free-form text is allowed here.\n\n## Output\nConfirm the message was marked read and report the reply that was sent.',
    },
  ],
} as const satisfies BlockMeta
