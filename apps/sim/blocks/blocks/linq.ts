import { LinqIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'

const CHAT_ID_OPS = [
  'get_chat',
  'update_chat',
  'mark_chat_read',
  'leave_chat',
  'share_contact_card',
  'send_voice_memo',
  'add_participant',
  'remove_participant',
  'start_typing',
  'stop_typing',
  'send_message',
  'list_messages',
] as const

const MESSAGE_ID_OPS = [
  'get_message',
  'list_thread',
  'edit_message',
  'delete_message',
  'react_to_message',
] as const

const ATTACHMENT_ID_OPS = ['get_attachment', 'delete_attachment'] as const

const SUBSCRIPTION_ID_OPS = [
  'get_webhook_subscription',
  'update_webhook_subscription',
  'delete_webhook_subscription',
] as const

const MESSAGE_CONTENT_OPS = ['create_chat', 'send_message'] as const

const CONTACT_CARD_OPS = ['get_contact_card', 'create_contact_card', 'update_contact_card'] as const

const CONTACT_CARD_WRITE_OPS = ['create_contact_card', 'update_contact_card'] as const

const WEBHOOK_WRITE_OPS = ['create_webhook_subscription', 'update_webhook_subscription'] as const

const PAGINATION_OPS = ['list_chats', 'list_messages', 'list_thread'] as const

const CAPABILITY_OPS = ['check_imessage', 'check_rcs'] as const

const PARTICIPANT_OPS = ['add_participant', 'remove_participant'] as const

const splitHandles = (value: unknown): string[] =>
  String(value)
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)

export const LinqBlock: BlockConfig = {
  type: 'linq',
  name: 'Linq',
  description: 'Send iMessage, SMS, and RCS messages and manage conversations with Linq',
  longDescription:
    'Reach people on iMessage, SMS, and RCS through Linq. Start chats, send messages with media, links, effects, and replies, send voice memos, react with tapbacks, manage group participants, check iMessage/RCS capability, configure contact cards, and subscribe to webhook events — all through a single Linq API key.',
  docsLink: 'https://docs.sim.ai/tools/linq',
  category: 'tools',
  integrationType: IntegrationType.Communication,
  tags: ['messaging', 'automation', 'webhooks'],
  bgColor: '#000000',
  icon: LinqIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Message', id: 'send_message' },
        { label: 'Create Chat', id: 'create_chat' },
        { label: 'List Chats', id: 'list_chats' },
        { label: 'Get Chat', id: 'get_chat' },
        { label: 'Update Chat', id: 'update_chat' },
        { label: 'Mark Chat as Read', id: 'mark_chat_read' },
        { label: 'Leave Chat', id: 'leave_chat' },
        { label: 'Add Participant', id: 'add_participant' },
        { label: 'Remove Participant', id: 'remove_participant' },
        { label: 'Start Typing', id: 'start_typing' },
        { label: 'Stop Typing', id: 'stop_typing' },
        { label: 'Send Voice Memo', id: 'send_voice_memo' },
        { label: 'Share Contact Card', id: 'share_contact_card' },
        { label: 'List Messages', id: 'list_messages' },
        { label: 'List Thread', id: 'list_thread' },
        { label: 'Get Message', id: 'get_message' },
        { label: 'Edit Message', id: 'edit_message' },
        { label: 'Delete Message', id: 'delete_message' },
        { label: 'React to Message', id: 'react_to_message' },
        { label: 'Create Attachment', id: 'create_attachment' },
        { label: 'Get Attachment', id: 'get_attachment' },
        { label: 'Delete Attachment', id: 'delete_attachment' },
        { label: 'List Phone Numbers', id: 'list_phone_numbers' },
        { label: 'Check iMessage', id: 'check_imessage' },
        { label: 'Check RCS', id: 'check_rcs' },
        { label: 'Get Contact Card', id: 'get_contact_card' },
        { label: 'Create Contact Card', id: 'create_contact_card' },
        { label: 'Update Contact Card', id: 'update_contact_card' },
        { label: 'Create Webhook Subscription', id: 'create_webhook_subscription' },
        { label: 'List Webhook Subscriptions', id: 'list_webhook_subscriptions' },
        { label: 'Get Webhook Subscription', id: 'get_webhook_subscription' },
        { label: 'Update Webhook Subscription', id: 'update_webhook_subscription' },
        { label: 'Delete Webhook Subscription', id: 'delete_webhook_subscription' },
        { label: 'List Webhook Events', id: 'list_webhook_events' },
      ],
      value: () => 'send_message',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Linq API key',
      required: true,
      password: true,
    },

    {
      id: 'chatId',
      title: 'Chat ID',
      type: 'short-input',
      placeholder: 'Chat UUID',
      condition: { field: 'operation', value: [...CHAT_ID_OPS] },
      required: { field: 'operation', value: [...CHAT_ID_OPS] },
    },

    // Create Chat - recipients
    {
      id: 'senderFrom',
      title: 'From',
      type: 'short-input',
      placeholder: '+14155551234 (your sending number, E.164)',
      condition: { field: 'operation', value: 'create_chat' },
      required: { field: 'operation', value: 'create_chat' },
    },
    {
      id: 'recipients',
      title: 'To',
      type: 'long-input',
      placeholder: 'Comma- or newline-separated handles (+14155550000, alice@example.com)',
      condition: { field: 'operation', value: 'create_chat' },
      required: { field: 'operation', value: 'create_chat' },
    },

    // Message content (create_chat + send_message)
    {
      id: 'messageText',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Message text (or leave blank to send only media, an attachment, or a link)',
      condition: { field: 'operation', value: [...MESSAGE_CONTENT_OPS] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a friendly, concise message body suitable for iMessage or SMS. Return ONLY the message text - no explanations, no extra text.',
        placeholder: 'Describe the message purpose and tone...',
      },
    },
    {
      id: 'mediaUrl',
      title: 'Media URL',
      type: 'short-input',
      placeholder: 'https://cdn.example.com/image.png (optional)',
      condition: { field: 'operation', value: [...MESSAGE_CONTENT_OPS] },
      mode: 'advanced',
    },
    {
      id: 'mediaAttachmentId',
      title: 'Attachment ID',
      type: 'short-input',
      placeholder: 'Pre-uploaded attachment ID (optional)',
      condition: { field: 'operation', value: [...MESSAGE_CONTENT_OPS] },
      mode: 'advanced',
    },
    {
      id: 'linkUrl',
      title: 'Link URL',
      type: 'short-input',
      placeholder: 'https://example.com (sent as its own preview; ignores text/media)',
      condition: { field: 'operation', value: 'send_message' },
      mode: 'advanced',
    },
    {
      id: 'preferredService',
      title: 'Preferred Service',
      type: 'dropdown',
      options: [
        { label: 'Auto', id: '' },
        { label: 'iMessage', id: 'iMessage' },
        { label: 'SMS', id: 'SMS' },
        { label: 'RCS', id: 'RCS' },
      ],
      value: () => '',
      condition: { field: 'operation', value: [...MESSAGE_CONTENT_OPS] },
      mode: 'advanced',
    },
    {
      id: 'effectName',
      title: 'Effect Name',
      type: 'short-input',
      placeholder: 'confetti, fireworks, lasers (optional)',
      condition: { field: 'operation', value: [...MESSAGE_CONTENT_OPS] },
      mode: 'advanced',
    },
    {
      id: 'effectType',
      title: 'Effect Type',
      type: 'dropdown',
      options: [
        { label: 'None', id: '' },
        { label: 'Screen', id: 'screen' },
        { label: 'Bubble', id: 'bubble' },
      ],
      value: () => '',
      condition: { field: 'operation', value: [...MESSAGE_CONTENT_OPS] },
      mode: 'advanced',
    },
    {
      id: 'replyToMessageId',
      title: 'Reply to Message ID',
      type: 'short-input',
      placeholder: 'Message ID to reply to inline (optional)',
      condition: { field: 'operation', value: [...MESSAGE_CONTENT_OPS] },
      mode: 'advanced',
    },
    {
      id: 'replyToPartIndex',
      title: 'Reply Part Index',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: [...MESSAGE_CONTENT_OPS] },
      mode: 'advanced',
    },
    {
      id: 'idempotencyKey',
      title: 'Idempotency Key',
      type: 'short-input',
      placeholder: 'Unique key to safely retry (optional)',
      condition: { field: 'operation', value: [...MESSAGE_CONTENT_OPS] },
      mode: 'advanced',
    },

    // Update Chat
    {
      id: 'displayName',
      title: 'Display Name',
      type: 'short-input',
      placeholder: 'New group chat name',
      condition: { field: 'operation', value: 'update_chat' },
    },
    {
      id: 'groupChatIcon',
      title: 'Group Chat Icon',
      type: 'short-input',
      placeholder: 'https://cdn.example.com/icon.png',
      condition: { field: 'operation', value: 'update_chat' },
      mode: 'advanced',
    },

    // Participants
    {
      id: 'participantHandle',
      title: 'Participant Handle',
      type: 'short-input',
      placeholder: '+14155550000 or alice@example.com',
      condition: { field: 'operation', value: [...PARTICIPANT_OPS] },
      required: { field: 'operation', value: [...PARTICIPANT_OPS] },
    },

    // Send Voice Memo (provide either a URL or a pre-uploaded attachment ID)
    {
      id: 'voiceMemoUrl',
      title: 'Voice Memo URL',
      type: 'short-input',
      placeholder: 'https://cdn.example.com/memo.m4a (required unless an Attachment ID is set)',
      condition: { field: 'operation', value: 'send_voice_memo' },
    },
    {
      id: 'voiceAttachmentId',
      title: 'Attachment ID',
      type: 'short-input',
      placeholder: 'Pre-uploaded audio attachment ID (use instead of a URL)',
      condition: { field: 'operation', value: 'send_voice_memo' },
      mode: 'advanced',
    },

    // List Chats filters
    {
      id: 'filterFrom',
      title: 'From',
      type: 'short-input',
      placeholder: 'Filter by sender number (E.164)',
      condition: { field: 'operation', value: 'list_chats' },
      mode: 'advanced',
    },
    {
      id: 'filterTo',
      title: 'To',
      type: 'short-input',
      placeholder: 'Filter by participant handle',
      condition: { field: 'operation', value: 'list_chats' },
      mode: 'advanced',
    },

    // Message ID (message-level operations)
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'Message UUID',
      condition: { field: 'operation', value: [...MESSAGE_ID_OPS] },
      required: { field: 'operation', value: [...MESSAGE_ID_OPS] },
    },

    // Edit Message
    {
      id: 'editText',
      title: 'New Text',
      type: 'long-input',
      placeholder: 'Updated message text',
      condition: { field: 'operation', value: 'edit_message' },
      required: { field: 'operation', value: 'edit_message' },
    },
    {
      id: 'editPartIndex',
      title: 'Part Index',
      type: 'short-input',
      placeholder: '0',
      condition: { field: 'operation', value: 'edit_message' },
      mode: 'advanced',
    },

    // React to Message
    {
      id: 'reactionOperation',
      title: 'Reaction Operation',
      type: 'dropdown',
      options: [
        { label: 'Add', id: 'add' },
        { label: 'Remove', id: 'remove' },
      ],
      value: () => 'add',
      condition: { field: 'operation', value: 'react_to_message' },
      required: { field: 'operation', value: 'react_to_message' },
    },
    {
      id: 'reactionType',
      title: 'Reaction Type',
      type: 'dropdown',
      options: [
        { label: 'Love', id: 'love' },
        { label: 'Like', id: 'like' },
        { label: 'Dislike', id: 'dislike' },
        { label: 'Laugh', id: 'laugh' },
        { label: 'Emphasize', id: 'emphasize' },
        { label: 'Question', id: 'question' },
        { label: 'Custom Emoji', id: 'custom' },
        { label: 'Sticker', id: 'sticker' },
      ],
      value: () => 'love',
      condition: { field: 'operation', value: 'react_to_message' },
      required: { field: 'operation', value: 'react_to_message' },
    },
    {
      id: 'reactionCustomEmoji',
      title: 'Custom Emoji',
      type: 'short-input',
      placeholder: '🎉 (required when type is Custom Emoji)',
      condition: { field: 'operation', value: 'react_to_message' },
      mode: 'advanced',
    },
    {
      id: 'reactionPartIndex',
      title: 'Part Index',
      type: 'short-input',
      placeholder: 'Defaults to the entire message',
      condition: { field: 'operation', value: 'react_to_message' },
      mode: 'advanced',
    },

    // Create Attachment (file upload)
    {
      id: 'uploadFile',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload a file to attach (max 100MB)',
      multiple: false,
      condition: { field: 'operation', value: 'create_attachment' },
      required: { field: 'operation', value: 'create_attachment' },
      mode: 'basic',
    },
    {
      id: 'fileRef',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference a file from a previous block (e.g. {{block.output.file}})',
      condition: { field: 'operation', value: 'create_attachment' },
      required: { field: 'operation', value: 'create_attachment' },
      mode: 'advanced',
    },
    {
      id: 'attachmentFilename',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Override the file name (optional)',
      condition: { field: 'operation', value: 'create_attachment' },
      mode: 'advanced',
    },
    {
      id: 'attachmentContentType',
      title: 'Content Type',
      type: 'short-input',
      placeholder: 'Override MIME type, e.g. image/png (optional)',
      condition: { field: 'operation', value: 'create_attachment' },
      mode: 'advanced',
    },

    // Attachment ID (get/delete)
    {
      id: 'attachmentId',
      title: 'Attachment ID',
      type: 'short-input',
      placeholder: 'Attachment UUID',
      condition: { field: 'operation', value: [...ATTACHMENT_ID_OPS] },
      required: { field: 'operation', value: [...ATTACHMENT_ID_OPS] },
    },

    // Capability checks
    {
      id: 'address',
      title: 'Address',
      type: 'short-input',
      placeholder: '+14155550000 or alice@example.com',
      condition: { field: 'operation', value: [...CAPABILITY_OPS] },
      required: { field: 'operation', value: [...CAPABILITY_OPS] },
    },
    {
      id: 'capabilityFrom',
      title: 'From',
      type: 'short-input',
      placeholder: 'Sender number to check from (optional)',
      condition: { field: 'operation', value: [...CAPABILITY_OPS] },
      mode: 'advanced',
    },

    // Contact Card
    {
      id: 'contactPhoneNumber',
      title: 'Phone Number',
      type: 'short-input',
      placeholder: '+14155551234',
      condition: { field: 'operation', value: [...CONTACT_CARD_OPS] },
      required: { field: 'operation', value: [...CONTACT_CARD_WRITE_OPS] },
    },
    {
      id: 'contactFirstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: 'Alice',
      condition: { field: 'operation', value: [...CONTACT_CARD_WRITE_OPS] },
      required: { field: 'operation', value: 'create_contact_card' },
    },
    {
      id: 'contactLastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: 'Johnson',
      condition: { field: 'operation', value: [...CONTACT_CARD_WRITE_OPS] },
      mode: 'advanced',
    },
    {
      id: 'contactImageUrl',
      title: 'Profile Photo URL',
      type: 'short-input',
      placeholder: 'https://cdn.example.com/avatar.png',
      condition: { field: 'operation', value: [...CONTACT_CARD_WRITE_OPS] },
      mode: 'advanced',
    },

    // Webhook Subscriptions
    {
      id: 'subscriptionId',
      title: 'Subscription ID',
      type: 'short-input',
      placeholder: 'Subscription UUID',
      condition: { field: 'operation', value: [...SUBSCRIPTION_ID_OPS] },
      required: { field: 'operation', value: [...SUBSCRIPTION_ID_OPS] },
    },
    {
      id: 'webhookTargetUrl',
      title: 'Target URL',
      type: 'short-input',
      placeholder: 'https://example.com/webhooks/linq',
      condition: { field: 'operation', value: [...WEBHOOK_WRITE_OPS] },
      required: { field: 'operation', value: 'create_webhook_subscription' },
    },
    {
      id: 'webhookEvents',
      title: 'Subscribed Events',
      type: 'long-input',
      placeholder: 'Comma- or newline-separated (message.sent, message.delivered, reaction.added)',
      condition: { field: 'operation', value: [...WEBHOOK_WRITE_OPS] },
      required: { field: 'operation', value: 'create_webhook_subscription' },
    },
    {
      id: 'webhookPhoneNumbers',
      title: 'Phone Numbers',
      type: 'long-input',
      placeholder: 'Comma- or newline-separated E.164 numbers (optional, omit for all)',
      condition: { field: 'operation', value: [...WEBHOOK_WRITE_OPS] },
      mode: 'advanced',
    },
    {
      id: 'webhookIsActive',
      title: 'Active',
      type: 'dropdown',
      options: [
        { label: 'No change', id: '' },
        { label: 'Active', id: 'true' },
        { label: 'Inactive', id: 'false' },
      ],
      value: () => '',
      condition: { field: 'operation', value: 'update_webhook_subscription' },
      mode: 'advanced',
    },

    // Pagination (list operations)
    {
      id: 'order',
      title: 'Order',
      type: 'dropdown',
      options: [
        { label: 'Ascending (oldest first)', id: 'asc' },
        { label: 'Descending (newest first)', id: 'desc' },
      ],
      value: () => 'asc',
      condition: { field: 'operation', value: 'list_thread' },
      mode: 'advanced',
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '20',
      condition: { field: 'operation', value: [...PAGINATION_OPS] },
      mode: 'advanced',
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from a previous response',
      condition: { field: 'operation', value: [...PAGINATION_OPS] },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'linq_add_participant',
      'linq_check_imessage',
      'linq_check_rcs',
      'linq_create_attachment',
      'linq_create_chat',
      'linq_create_contact_card',
      'linq_create_webhook_subscription',
      'linq_delete_attachment',
      'linq_delete_message',
      'linq_delete_webhook_subscription',
      'linq_edit_message',
      'linq_get_attachment',
      'linq_get_chat',
      'linq_get_contact_card',
      'linq_get_message',
      'linq_get_webhook_subscription',
      'linq_leave_chat',
      'linq_list_chats',
      'linq_list_messages',
      'linq_list_phone_numbers',
      'linq_list_thread',
      'linq_list_webhook_events',
      'linq_list_webhook_subscriptions',
      'linq_mark_chat_read',
      'linq_react_to_message',
      'linq_remove_participant',
      'linq_send_message',
      'linq_send_voice_memo',
      'linq_share_contact_card',
      'linq_start_typing',
      'linq_stop_typing',
      'linq_update_chat',
      'linq_update_contact_card',
      'linq_update_webhook_subscription',
    ],
    config: {
      tool: (params) => `linq_${params.operation || 'send_message'}`,
      params: (params) => {
        const {
          operation,
          senderFrom,
          recipients,
          messageText,
          mediaAttachmentId,
          linkUrl,
          replyToPartIndex,
          displayName,
          groupChatIcon,
          participantHandle,
          voiceAttachmentId,
          filterFrom,
          filterTo,
          editText,
          editPartIndex,
          reactionOperation,
          reactionType,
          reactionCustomEmoji,
          reactionPartIndex,
          file,
          attachmentId,
          attachmentFilename,
          attachmentContentType,
          capabilityFrom,
          contactPhoneNumber,
          contactFirstName,
          contactLastName,
          contactImageUrl,
          webhookTargetUrl,
          webhookEvents,
          webhookPhoneNumbers,
          webhookIsActive,
          limit,
          ...rest
        } = params

        const toFiniteNumber = (value: unknown, field: string): number => {
          const parsed = Number(value)
          if (!Number.isFinite(parsed)) {
            throw new Error(`Invalid numeric value for ${field}: ${String(value)}`)
          }
          return parsed
        }

        if (operation === 'create_chat') {
          if (senderFrom) rest.from = senderFrom
          if (recipients !== undefined && recipients !== '') rest.to = splitHandles(recipients)
        }

        if (operation === 'create_chat' || operation === 'send_message') {
          if (messageText !== undefined) rest.text = messageText
          if (mediaAttachmentId) rest.attachmentId = mediaAttachmentId
          if (replyToPartIndex !== undefined && replyToPartIndex !== '') {
            rest.replyToPartIndex = toFiniteNumber(replyToPartIndex, 'Reply Part Index')
          }
        }

        // Links are only valid on send_message — Linq rejects a link as the first
        // message of a new chat, so it is never forwarded to create_chat.
        if (operation === 'send_message' && linkUrl) {
          rest.linkUrl = linkUrl
        }

        if (operation === 'update_chat') {
          if (displayName !== undefined && displayName !== '') rest.displayName = displayName
          if (groupChatIcon !== undefined && groupChatIcon !== '') {
            rest.groupChatIcon = groupChatIcon
          }
        }

        if (operation === 'add_participant' || operation === 'remove_participant') {
          if (participantHandle) rest.handle = participantHandle
        }

        if (operation === 'send_voice_memo' && voiceAttachmentId) {
          rest.attachmentId = voiceAttachmentId
        }

        if (
          ATTACHMENT_ID_OPS.includes(operation as (typeof ATTACHMENT_ID_OPS)[number]) &&
          attachmentId
        ) {
          rest.attachmentId = attachmentId
        }

        if (operation === 'list_chats') {
          if (filterFrom) rest.from = filterFrom
          if (filterTo) rest.to = filterTo
        }

        if (operation === 'edit_message') {
          if (editText !== undefined) rest.text = editText
          if (editPartIndex !== undefined && editPartIndex !== '') {
            rest.partIndex = toFiniteNumber(editPartIndex, 'Part Index')
          }
        }

        if (operation === 'react_to_message') {
          if (reactionOperation) rest.operation = reactionOperation
          if (reactionType) rest.type = reactionType
          if (reactionCustomEmoji) rest.customEmoji = reactionCustomEmoji
          if (reactionPartIndex !== undefined && reactionPartIndex !== '') {
            rest.partIndex = toFiniteNumber(reactionPartIndex, 'Part Index')
          }
        }

        if (operation === 'create_attachment') {
          const normalizedFile = normalizeFileInput(file, { single: true })
          if (normalizedFile) rest.file = normalizedFile
          if (attachmentFilename) rest.filename = attachmentFilename
          if (attachmentContentType) rest.contentType = attachmentContentType
        }

        if ((operation === 'check_imessage' || operation === 'check_rcs') && capabilityFrom) {
          rest.from = capabilityFrom
        }

        if (CONTACT_CARD_OPS.includes(operation as (typeof CONTACT_CARD_OPS)[number])) {
          if (contactPhoneNumber) rest.phoneNumber = contactPhoneNumber
        }

        if (CONTACT_CARD_WRITE_OPS.includes(operation as (typeof CONTACT_CARD_WRITE_OPS)[number])) {
          if (contactFirstName !== undefined && contactFirstName !== '') {
            rest.firstName = contactFirstName
          }
          if (contactLastName !== undefined && contactLastName !== '') {
            rest.lastName = contactLastName
          }
          if (contactImageUrl !== undefined && contactImageUrl !== '') {
            rest.imageUrl = contactImageUrl
          }
        }

        if (WEBHOOK_WRITE_OPS.includes(operation as (typeof WEBHOOK_WRITE_OPS)[number])) {
          if (webhookTargetUrl !== undefined && webhookTargetUrl !== '') {
            rest.targetUrl = webhookTargetUrl
          }
          if (webhookEvents !== undefined && webhookEvents !== '') {
            rest.subscribedEvents = splitHandles(webhookEvents)
          }
          if (webhookPhoneNumbers !== undefined && webhookPhoneNumbers !== '') {
            rest.phoneNumbers = splitHandles(webhookPhoneNumbers)
          }
        }

        if (operation === 'update_webhook_subscription' && webhookIsActive) {
          rest.isActive = webhookIsActive === 'true'
        }

        if (
          PAGINATION_OPS.includes(operation as (typeof PAGINATION_OPS)[number]) &&
          limit !== undefined &&
          limit !== ''
        ) {
          rest.limit = toFiniteNumber(limit, 'Limit')
        }

        return rest
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Linq API key' },
    chatId: { type: 'string', description: 'Chat ID' },
    senderFrom: { type: 'string', description: 'Sender phone number for a new chat' },
    recipients: { type: 'string', description: 'Recipient handles for a new chat' },
    messageText: { type: 'string', description: 'Message text content' },
    mediaUrl: { type: 'string', description: 'Media URL to attach' },
    mediaAttachmentId: { type: 'string', description: 'Pre-uploaded attachment ID for a message' },
    linkUrl: { type: 'string', description: 'Rich link preview URL' },
    preferredService: { type: 'string', description: 'Preferred delivery service' },
    effectName: { type: 'string', description: 'iMessage effect name' },
    effectType: { type: 'string', description: 'iMessage effect type (screen or bubble)' },
    replyToMessageId: { type: 'string', description: 'Message ID to reply to' },
    replyToPartIndex: { type: 'string', description: 'Part index of the replied-to message' },
    idempotencyKey: { type: 'string', description: 'Idempotency key' },
    displayName: { type: 'string', description: 'Group chat display name' },
    groupChatIcon: { type: 'string', description: 'Group chat icon URL' },
    participantHandle: { type: 'string', description: 'Participant handle to add or remove' },
    voiceMemoUrl: { type: 'string', description: 'Voice memo audio URL' },
    voiceAttachmentId: { type: 'string', description: 'Pre-uploaded audio attachment ID' },
    filterFrom: { type: 'string', description: 'List chats: filter by sender number' },
    filterTo: { type: 'string', description: 'List chats: filter by participant handle' },
    messageId: { type: 'string', description: 'Message ID' },
    editText: { type: 'string', description: 'New text for an edited message' },
    editPartIndex: { type: 'string', description: 'Part index to edit' },
    reactionOperation: { type: 'string', description: 'Add or remove a reaction' },
    reactionType: { type: 'string', description: 'Reaction type' },
    reactionCustomEmoji: { type: 'string', description: 'Custom emoji for a reaction' },
    reactionPartIndex: { type: 'string', description: 'Part index to react to' },
    file: { type: 'json', description: 'File to upload as an attachment' },
    attachmentFilename: { type: 'string', description: 'Override the attachment file name' },
    attachmentContentType: { type: 'string', description: 'Override the attachment MIME type' },
    attachmentId: { type: 'string', description: 'Attachment ID' },
    address: { type: 'string', description: 'Address to check capability for' },
    capabilityFrom: { type: 'string', description: 'Sender number to check capability from' },
    contactPhoneNumber: { type: 'string', description: 'Contact card phone number' },
    contactFirstName: { type: 'string', description: 'Contact card first name' },
    contactLastName: { type: 'string', description: 'Contact card last name' },
    contactImageUrl: { type: 'string', description: 'Contact card profile photo URL' },
    subscriptionId: { type: 'string', description: 'Webhook subscription ID' },
    webhookTargetUrl: { type: 'string', description: 'Webhook target URL' },
    webhookEvents: { type: 'string', description: 'Webhook subscribed event types' },
    webhookPhoneNumbers: { type: 'string', description: 'Webhook phone number filter' },
    webhookIsActive: { type: 'string', description: 'Whether the webhook subscription is active' },
    order: { type: 'string', description: 'Thread sort order (asc or desc)' },
    limit: { type: 'string', description: 'Pagination limit' },
    cursor: { type: 'string', description: 'Pagination cursor' },
  },

  outputs: {
    chatId: { type: 'string', description: 'Chat ID' },
    displayName: { type: 'string', description: 'Chat display name' },
    isGroup: { type: 'boolean', description: 'Whether the chat is a group chat' },
    isArchived: { type: 'boolean', description: 'Whether the chat is archived' },
    service: { type: 'string', description: 'Delivery service (iMessage, SMS, RCS)' },
    handles: { type: 'json', description: 'Participant handles' },
    healthStatus: { type: 'json', description: 'Messaging line health status' },
    chats: { type: 'json', description: 'Array of chats (list operations)' },
    messages: { type: 'json', description: 'Array of messages (list operations)' },
    nextCursor: { type: 'string', description: 'Pagination cursor for the next page' },
    messageId: { type: 'string', description: 'Message ID' },
    deliveryStatus: { type: 'string', description: 'Message delivery status' },
    sentAt: { type: 'string', description: 'ISO 8601 sent timestamp' },
    message: { type: 'json', description: 'A message object with parts and metadata' },
    parts: { type: 'json', description: 'Message parts (text, media, link) with reactions' },
    isFromMe: { type: 'boolean', description: 'Whether the message was sent by you' },
    isDelivered: { type: 'boolean', description: 'Whether the message was delivered' },
    isRead: { type: 'boolean', description: 'Whether the message was read' },
    createdAt: { type: 'string', description: 'ISO 8601 creation timestamp' },
    updatedAt: { type: 'string', description: 'ISO 8601 update timestamp' },
    status: { type: 'string', description: 'Status field (varies by operation)' },
    success: { type: 'boolean', description: 'Whether the action succeeded' },
    traceId: { type: 'string', description: 'Trace ID for a queued action' },
    id: { type: 'string', description: 'ID of the primary resource returned' },
    from: { type: 'string', description: 'Sender handle' },
    to: { type: 'json', description: 'Recipient handles' },
    voiceMemo: { type: 'json', description: 'Voice memo audio metadata' },
    attachmentId: { type: 'string', description: 'Attachment ID' },
    downloadUrl: { type: 'string', description: 'Attachment download URL' },
    filename: { type: 'string', description: 'Attachment file name' },
    contentType: { type: 'string', description: 'Attachment MIME type' },
    sizeBytes: { type: 'number', description: 'Attachment size in bytes' },
    phoneNumbers: { type: 'json', description: 'Phone numbers' },
    address: { type: 'string', description: 'Address checked for capability' },
    available: { type: 'boolean', description: 'Whether the address supports the service' },
    contactCards: { type: 'json', description: 'Contact cards' },
    phoneNumber: { type: 'string', description: 'Contact card phone number' },
    firstName: { type: 'string', description: 'Contact card first name' },
    lastName: { type: 'string', description: 'Contact card last name' },
    imageUrl: { type: 'string', description: 'Contact card profile photo URL' },
    isActive: { type: 'boolean', description: 'Whether the resource is active' },
    subscriptions: { type: 'json', description: 'Webhook subscriptions' },
    targetUrl: { type: 'string', description: 'Webhook target URL' },
    subscribedEvents: { type: 'json', description: 'Subscribed webhook event types' },
    signingSecret: { type: 'string', description: 'Webhook signing secret (returned once)' },
    events: { type: 'json', description: 'Available webhook event types' },
    docUrl: { type: 'string', description: 'Documentation URL' },
  },
}
