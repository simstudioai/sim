import { TelegramIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import { getTrigger } from '@/triggers'

export const TelegramBlock: BlockConfig = {
  type: 'telegram',
  name: 'Telegram',
  description: 'Interact with Telegram',
  authMode: AuthMode.BotToken,
  longDescription:
    'Integrate Telegram into the workflow. Send, edit, forward, copy, pin, and delete messages; send media, locations, contacts, and polls; react to messages; show chat actions; and look up chat and member info. Can be used in trigger mode to start a workflow when a message is sent to a chat.',
  docsLink: 'https://docs.sim.ai/integrations/telegram',
  category: 'tools',
  integrationType: IntegrationType.Communication,
  bgColor: '#FFFFFF',
  icon: TelegramIcon,
  triggerAllowed: true,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Send Message', id: 'telegram_message' },
        { label: 'Send Photo', id: 'telegram_send_photo' },
        { label: 'Send Video', id: 'telegram_send_video' },
        { label: 'Send Audio', id: 'telegram_send_audio' },
        { label: 'Send Animation', id: 'telegram_send_animation' },
        { label: 'Send Document', id: 'telegram_send_document' },
        { label: 'Send Location', id: 'telegram_send_location' },
        { label: 'Send Contact', id: 'telegram_send_contact' },
        { label: 'Send Poll', id: 'telegram_send_poll' },
        { label: 'Send Chat Action', id: 'telegram_send_chat_action' },
        { label: 'Edit Message Text', id: 'telegram_edit_message_text' },
        { label: 'Forward Message', id: 'telegram_forward_message' },
        { label: 'Copy Message', id: 'telegram_copy_message' },
        { label: 'Delete Message', id: 'telegram_delete_message' },
        { label: 'Pin Message', id: 'telegram_pin_message' },
        { label: 'Unpin Message', id: 'telegram_unpin_message' },
        { label: 'Set Message Reaction', id: 'telegram_set_message_reaction' },
        { label: 'Get Chat', id: 'telegram_get_chat' },
        { label: 'Get Chat Member', id: 'telegram_get_chat_member' },
      ],
      value: () => 'telegram_message',
    },
    {
      id: 'botToken',
      title: 'Bot Token',
      type: 'short-input',
      placeholder: 'Enter your Telegram Bot Token',
      password: true,
      connectionDroppable: false,
      description: `Getting Bot Token:
1. If you haven't already, message "/newbot" to @BotFather
2. Choose a name for your bot
3. Copy the token it provides and paste it here`,
      required: true,
    },
    {
      id: 'chatId',
      title: 'Chat ID',
      type: 'short-input',
      placeholder: 'Enter Telegram Chat ID',
      description: `Getting Chat ID:
1. Add your bot as a member to desired Telegram channel
2. Send any message to the channel (e.g. "I love Sim")
3. Visit https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
4. Look for the chat field in the JSON response at the very bottom where you'll find the chat ID`,
      required: true,
    },
    {
      id: 'text',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Enter the message to send',
      required: { field: 'operation', value: ['telegram_message', 'telegram_edit_message_text'] },
      condition: { field: 'operation', value: ['telegram_message', 'telegram_edit_message_text'] },
    },
    {
      id: 'photoFile',
      title: 'Photo',
      type: 'file-upload',
      canonicalParamId: 'photo',
      placeholder: 'Upload photo',
      mode: 'basic',
      multiple: false,
      required: true,
      acceptedTypes: '.jpg,.jpeg,.png,.gif,.webp',
      condition: { field: 'operation', value: 'telegram_send_photo' },
    },
    {
      id: 'photo',
      title: 'Photo',
      type: 'short-input',
      canonicalParamId: 'photo',
      placeholder: 'Reference photo from previous blocks or enter URL/file_id',
      mode: 'advanced',
      required: true,
      condition: { field: 'operation', value: 'telegram_send_photo' },
    },
    {
      id: 'videoFile',
      title: 'Video',
      type: 'file-upload',
      canonicalParamId: 'video',
      placeholder: 'Upload video',
      mode: 'basic',
      multiple: false,
      required: true,
      acceptedTypes: '.mp4,.mov,.avi,.mkv,.webm',
      condition: { field: 'operation', value: 'telegram_send_video' },
    },
    {
      id: 'video',
      title: 'Video',
      type: 'short-input',
      canonicalParamId: 'video',
      placeholder: 'Reference video from previous blocks or enter URL/file_id',
      mode: 'advanced',
      required: true,
      condition: { field: 'operation', value: 'telegram_send_video' },
    },
    {
      id: 'audioFile',
      title: 'Audio',
      type: 'file-upload',
      canonicalParamId: 'audio',
      placeholder: 'Upload audio',
      mode: 'basic',
      multiple: false,
      required: true,
      acceptedTypes: '.mp3,.m4a,.wav,.ogg,.flac',
      condition: { field: 'operation', value: 'telegram_send_audio' },
    },
    {
      id: 'audio',
      title: 'Audio',
      type: 'short-input',
      canonicalParamId: 'audio',
      placeholder: 'Reference audio from previous blocks or enter URL/file_id',
      mode: 'advanced',
      required: true,
      condition: { field: 'operation', value: 'telegram_send_audio' },
    },
    {
      id: 'animationFile',
      title: 'Animation',
      type: 'file-upload',
      canonicalParamId: 'animation',
      placeholder: 'Upload animation (GIF)',
      mode: 'basic',
      multiple: false,
      required: true,
      acceptedTypes: '.gif,.mp4',
      condition: { field: 'operation', value: 'telegram_send_animation' },
    },
    {
      id: 'animation',
      title: 'Animation',
      type: 'short-input',
      canonicalParamId: 'animation',
      placeholder: 'Reference animation from previous blocks or enter URL/file_id',
      mode: 'advanced',
      required: true,
      condition: { field: 'operation', value: 'telegram_send_animation' },
    },
    // File upload (basic mode) for Send Document
    {
      id: 'attachmentFiles',
      title: 'Document',
      type: 'file-upload',
      canonicalParamId: 'files',
      placeholder: 'Upload document file',
      condition: { field: 'operation', value: 'telegram_send_document' },
      mode: 'basic',
      multiple: false,
      required: false,
      description: 'Document file to send (PDF, ZIP, DOC, etc.). Max size: 50MB',
    },
    // Variable reference (advanced mode) for Send Document
    {
      id: 'files',
      title: 'Document',
      type: 'short-input',
      canonicalParamId: 'files',
      placeholder: 'Reference document from previous blocks',
      condition: { field: 'operation', value: 'telegram_send_document' },
      mode: 'advanced',
      required: false,
      description: 'Reference a document file from a previous block',
    },
    {
      id: 'caption',
      title: 'Caption',
      type: 'long-input',
      placeholder: 'Enter optional caption',
      description: 'Media caption (optional)',
      condition: {
        field: 'operation',
        value: [
          'telegram_send_photo',
          'telegram_send_video',
          'telegram_send_audio',
          'telegram_send_animation',
          'telegram_send_document',
          'telegram_copy_message',
        ],
      },
    },
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'Enter the message ID',
      description: 'The unique identifier of the target message',
      required: {
        field: 'operation',
        value: [
          'telegram_delete_message',
          'telegram_edit_message_text',
          'telegram_forward_message',
          'telegram_copy_message',
          'telegram_pin_message',
          'telegram_set_message_reaction',
        ],
      },
      condition: {
        field: 'operation',
        value: [
          'telegram_delete_message',
          'telegram_edit_message_text',
          'telegram_forward_message',
          'telegram_copy_message',
          'telegram_pin_message',
          'telegram_unpin_message',
          'telegram_set_message_reaction',
        ],
      },
    },
    {
      id: 'fromChatId',
      title: 'From Chat ID',
      type: 'short-input',
      placeholder: 'Enter the source chat ID',
      description: 'The chat ID where the original message currently lives',
      required: {
        field: 'operation',
        value: ['telegram_forward_message', 'telegram_copy_message'],
      },
      condition: {
        field: 'operation',
        value: ['telegram_forward_message', 'telegram_copy_message'],
      },
    },
    {
      id: 'latitude',
      title: 'Latitude',
      type: 'short-input',
      placeholder: 'e.g., 37.7749',
      required: { field: 'operation', value: 'telegram_send_location' },
      condition: { field: 'operation', value: 'telegram_send_location' },
    },
    {
      id: 'longitude',
      title: 'Longitude',
      type: 'short-input',
      placeholder: 'e.g., -122.4194',
      required: { field: 'operation', value: 'telegram_send_location' },
      condition: { field: 'operation', value: 'telegram_send_location' },
    },
    {
      id: 'phoneNumber',
      title: 'Phone Number',
      type: 'short-input',
      placeholder: "Contact's phone number",
      required: { field: 'operation', value: 'telegram_send_contact' },
      condition: { field: 'operation', value: 'telegram_send_contact' },
    },
    {
      id: 'firstName',
      title: 'First Name',
      type: 'short-input',
      placeholder: "Contact's first name",
      required: { field: 'operation', value: 'telegram_send_contact' },
      condition: { field: 'operation', value: 'telegram_send_contact' },
    },
    {
      id: 'lastName',
      title: 'Last Name',
      type: 'short-input',
      placeholder: "Contact's last name (optional)",
      mode: 'advanced',
      condition: { field: 'operation', value: 'telegram_send_contact' },
    },
    {
      id: 'vcard',
      title: 'vCard',
      type: 'long-input',
      placeholder: 'Additional contact data as a vCard (optional)',
      mode: 'advanced',
      condition: { field: 'operation', value: 'telegram_send_contact' },
    },
    {
      id: 'question',
      title: 'Poll Question',
      type: 'long-input',
      placeholder: 'Enter the poll question',
      required: { field: 'operation', value: 'telegram_send_poll' },
      condition: { field: 'operation', value: 'telegram_send_poll' },
    },
    {
      id: 'pollOptions',
      title: 'Poll Options',
      type: 'long-input',
      placeholder: 'One answer option per line (2-10 options)',
      description: 'Enter each answer option on its own line',
      required: { field: 'operation', value: 'telegram_send_poll' },
      condition: { field: 'operation', value: 'telegram_send_poll' },
    },
    {
      id: 'isAnonymous',
      title: 'Anonymous Poll',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'telegram_send_poll' },
    },
    {
      id: 'allowsMultipleAnswers',
      title: 'Allow Multiple Answers',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'telegram_send_poll' },
    },
    {
      id: 'action',
      title: 'Chat Action',
      type: 'dropdown',
      options: [
        { label: 'Typing', id: 'typing' },
        { label: 'Upload Photo', id: 'upload_photo' },
        { label: 'Record Video', id: 'record_video' },
        { label: 'Upload Video', id: 'upload_video' },
        { label: 'Record Voice', id: 'record_voice' },
        { label: 'Upload Voice', id: 'upload_voice' },
        { label: 'Upload Document', id: 'upload_document' },
        { label: 'Choose Sticker', id: 'choose_sticker' },
        { label: 'Find Location', id: 'find_location' },
        { label: 'Record Video Note', id: 'record_video_note' },
        { label: 'Upload Video Note', id: 'upload_video_note' },
      ],
      value: () => 'typing',
      required: { field: 'operation', value: 'telegram_send_chat_action' },
      condition: { field: 'operation', value: 'telegram_send_chat_action' },
    },
    {
      id: 'reactionEmoji',
      title: 'Reaction Emoji',
      type: 'short-input',
      placeholder: 'e.g., 👍 (leave empty to remove the reaction)',
      condition: { field: 'operation', value: 'telegram_set_message_reaction' },
    },
    {
      id: 'isBig',
      title: 'Big Reaction',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'telegram_set_message_reaction' },
    },
    {
      id: 'disableNotification',
      title: 'Silent Pin',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'telegram_pin_message' },
    },
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Enter the target user ID',
      required: { field: 'operation', value: 'telegram_get_chat_member' },
      condition: { field: 'operation', value: 'telegram_get_chat_member' },
    },
    ...getTrigger('telegram_webhook').subBlocks,
  ],
  tools: {
    access: [
      'telegram_message',
      'telegram_delete_message',
      'telegram_send_photo',
      'telegram_send_video',
      'telegram_send_audio',
      'telegram_send_animation',
      'telegram_send_document',
      'telegram_edit_message_text',
      'telegram_forward_message',
      'telegram_copy_message',
      'telegram_send_location',
      'telegram_send_contact',
      'telegram_send_poll',
      'telegram_pin_message',
      'telegram_unpin_message',
      'telegram_set_message_reaction',
      'telegram_send_chat_action',
      'telegram_get_chat',
      'telegram_get_chat_member',
    ],
    config: {
      tool: (params) => params.operation || 'telegram_message',
      params: (params) => {
        if (!params.botToken) throw new Error('Bot token required for this operation')

        const chatId = (params.chatId || '').trim()
        if (!chatId) {
          throw new Error('Chat ID is required.')
        }

        const commonParams = {
          botToken: params.botToken,
          chatId,
        }

        /** Coerce string/number input to a finite number, throwing with a labeled message. */
        const requireNumber = (value: unknown, label: string): number => {
          const num = Number(value)
          if (value === undefined || value === null || value === '' || Number.isNaN(num)) {
            throw new Error(`${label} is required and must be a number.`)
          }
          return num
        }

        /** Coerce agent-supplied "true"/"false" strings (or booleans) to a real boolean. */
        const toBoolean = (value: unknown): boolean =>
          value === true || String(value).toLowerCase() === 'true'

        switch (params.operation) {
          case 'telegram_message':
            if (!params.text) {
              throw new Error('Message text is required.')
            }
            return {
              ...commonParams,
              text: params.text,
            }
          case 'telegram_delete_message':
            return {
              ...commonParams,
              messageId: requireNumber(params.messageId, 'Message ID'),
            }
          case 'telegram_send_photo': {
            // photo is the canonical param for both basic (photoFile) and advanced modes
            const photoSource = normalizeFileInput(params.photo, {
              single: true,
            })
            if (!photoSource) {
              throw new Error('Photo is required.')
            }
            return {
              ...commonParams,
              photo: photoSource,
              caption: params.caption,
            }
          }
          case 'telegram_send_video': {
            // video is the canonical param for both basic (videoFile) and advanced modes
            const videoSource = normalizeFileInput(params.video, {
              single: true,
            })
            if (!videoSource) {
              throw new Error('Video is required.')
            }
            return {
              ...commonParams,
              video: videoSource,
              caption: params.caption,
            }
          }
          case 'telegram_send_audio': {
            // audio is the canonical param for both basic (audioFile) and advanced modes
            const audioSource = normalizeFileInput(params.audio, {
              single: true,
            })
            if (!audioSource) {
              throw new Error('Audio is required.')
            }
            return {
              ...commonParams,
              audio: audioSource,
              caption: params.caption,
            }
          }
          case 'telegram_send_animation': {
            // animation is the canonical param for both basic (animationFile) and advanced modes
            const animationSource = normalizeFileInput(params.animation, {
              single: true,
            })
            if (!animationSource) {
              throw new Error('Animation is required.')
            }
            return {
              ...commonParams,
              animation: animationSource,
              caption: params.caption,
            }
          }
          case 'telegram_send_document': {
            // files is the canonical param for both basic (attachmentFiles) and advanced modes
            return {
              ...commonParams,
              files: normalizeFileInput(params.files),
              caption: params.caption,
            }
          }
          case 'telegram_edit_message_text':
            if (!params.text) {
              throw new Error('Message text is required.')
            }
            return {
              ...commonParams,
              messageId: requireNumber(params.messageId, 'Message ID'),
              text: params.text,
            }
          case 'telegram_forward_message': {
            const fromChatId = (params.fromChatId || '').trim()
            if (!fromChatId) {
              throw new Error('Source chat ID is required.')
            }
            return {
              ...commonParams,
              fromChatId,
              messageId: requireNumber(params.messageId, 'Message ID'),
            }
          }
          case 'telegram_copy_message': {
            const fromChatId = (params.fromChatId || '').trim()
            if (!fromChatId) {
              throw new Error('Source chat ID is required.')
            }
            return {
              ...commonParams,
              fromChatId,
              messageId: requireNumber(params.messageId, 'Message ID'),
              caption: params.caption,
            }
          }
          case 'telegram_send_location':
            return {
              ...commonParams,
              latitude: requireNumber(params.latitude, 'Latitude'),
              longitude: requireNumber(params.longitude, 'Longitude'),
            }
          case 'telegram_send_contact':
            if (!params.phoneNumber || !params.firstName) {
              throw new Error('Phone number and first name are required.')
            }
            return {
              ...commonParams,
              phoneNumber: params.phoneNumber,
              firstName: params.firstName,
              lastName: params.lastName,
              vcard: params.vcard,
            }
          case 'telegram_send_poll': {
            if (!params.question) {
              throw new Error('Poll question is required.')
            }
            const pollParams: Record<string, unknown> = {
              ...commonParams,
              question: params.question,
              options: params.pollOptions,
            }
            if (params.isAnonymous !== undefined && params.isAnonymous !== '') {
              pollParams.isAnonymous = toBoolean(params.isAnonymous)
            }
            if (params.allowsMultipleAnswers !== undefined && params.allowsMultipleAnswers !== '') {
              pollParams.allowsMultipleAnswers = toBoolean(params.allowsMultipleAnswers)
            }
            return pollParams
          }
          case 'telegram_pin_message': {
            const pinParams: Record<string, unknown> = {
              ...commonParams,
              messageId: requireNumber(params.messageId, 'Message ID'),
            }
            if (params.disableNotification !== undefined && params.disableNotification !== '') {
              pinParams.disableNotification = toBoolean(params.disableNotification)
            }
            return pinParams
          }
          case 'telegram_unpin_message': {
            const unpinParams: Record<string, unknown> = { ...commonParams }
            if (params.messageId !== undefined && params.messageId !== '') {
              unpinParams.messageId = requireNumber(params.messageId, 'Message ID')
            }
            return unpinParams
          }
          case 'telegram_set_message_reaction': {
            const reactionParams: Record<string, unknown> = {
              ...commonParams,
              messageId: requireNumber(params.messageId, 'Message ID'),
              reaction: params.reactionEmoji,
            }
            if (params.isBig !== undefined && params.isBig !== '') {
              reactionParams.isBig = toBoolean(params.isBig)
            }
            return reactionParams
          }
          case 'telegram_send_chat_action':
            if (!params.action) {
              throw new Error('Chat action is required.')
            }
            return {
              ...commonParams,
              action: params.action,
            }
          case 'telegram_get_chat':
            return { ...commonParams }
          case 'telegram_get_chat_member':
            return {
              ...commonParams,
              userId: requireNumber(params.userId, 'User ID'),
            }
          default:
            return {
              ...commonParams,
              text: params.text,
            }
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    botToken: { type: 'string', description: 'Telegram bot token' },
    chatId: { type: 'string', description: 'Chat identifier' },
    text: { type: 'string', description: 'Message text' },
    photo: { type: 'json', description: 'Photo (UserFile or URL/file_id)' },
    video: { type: 'json', description: 'Video (UserFile or URL/file_id)' },
    audio: { type: 'json', description: 'Audio (UserFile or URL/file_id)' },
    animation: { type: 'json', description: 'Animation (UserFile or URL/file_id)' },
    files: { type: 'array', description: 'Files to attach (UserFile array)' },
    caption: { type: 'string', description: 'Caption for media' },
    messageId: { type: 'string', description: 'Target message ID' },
    fromChatId: { type: 'string', description: 'Source chat ID for forward/copy' },
    latitude: { type: 'string', description: 'Latitude of the location' },
    longitude: { type: 'string', description: 'Longitude of the location' },
    phoneNumber: { type: 'string', description: "Contact's phone number" },
    firstName: { type: 'string', description: "Contact's first name" },
    lastName: { type: 'string', description: "Contact's last name" },
    vcard: { type: 'string', description: 'Contact vCard data' },
    question: { type: 'string', description: 'Poll question' },
    pollOptions: { type: 'string', description: 'Poll answer options (one per line)' },
    isAnonymous: { type: 'string', description: 'Whether the poll is anonymous' },
    allowsMultipleAnswers: {
      type: 'string',
      description: 'Whether the poll allows multiple answers',
    },
    action: { type: 'string', description: 'Chat action to broadcast' },
    reactionEmoji: { type: 'string', description: 'Emoji to react with' },
    isBig: { type: 'string', description: 'Whether to show a big reaction animation' },
    disableNotification: { type: 'string', description: 'Pin the message silently' },
    userId: { type: 'string', description: 'Target user ID for chat member lookup' },
  },
  outputs: {
    // Send message operation outputs
    ok: { type: 'boolean', description: 'API response success status' },
    result: {
      type: 'json',
      description: 'Complete message result object from Telegram API',
    },
    message: { type: 'string', description: 'Success or error message' },
    data: { type: 'json', description: 'Response data' },
    files: { type: 'file[]', description: 'Files attached to the message' },
    // Specific result fields
    messageId: { type: 'number', description: 'Sent message ID' },
    chatId: { type: 'number', description: 'Chat ID where message was sent' },
    chatType: {
      type: 'string',
      description: 'Type of chat (private, group, supergroup, channel)',
    },
    username: { type: 'string', description: 'Chat username (if available)' },
    messageDate: {
      type: 'number',
      description: 'Unix timestamp of sent message',
    },
    messageText: {
      type: 'string',
      description: 'Text content of sent message',
    },
    // Delete message outputs
    deleted: {
      type: 'boolean',
      description: 'Whether the message was successfully deleted',
    },
    // Webhook trigger outputs (incoming messages)
    update_id: {
      type: 'number',
      description: 'Unique identifier for the update',
    },
    message_id: {
      type: 'number',
      description: 'Unique message identifier from webhook',
    },
    from_id: { type: 'number', description: 'User ID who sent the message' },
    from_username: { type: 'string', description: 'Username of the sender' },
    from_first_name: {
      type: 'string',
      description: 'First name of the sender',
    },
    from_last_name: { type: 'string', description: 'Last name of the sender' },
    chat_id: { type: 'number', description: 'Unique identifier for the chat' },
    chat_type: {
      type: 'string',
      description: 'Type of chat (private, group, supergroup, channel)',
    },
    chat_title: {
      type: 'string',
      description: 'Title of the chat (for groups and channels)',
    },
    text: { type: 'string', description: 'Message text content from webhook' },
    date: {
      type: 'number',
      description: 'Date the message was sent (Unix timestamp)',
    },
    entities: {
      type: 'json',
      description: 'Special entities in the message (mentions, hashtags, etc.)',
    },
  },
  triggers: {
    enabled: true,
    available: ['telegram_webhook'],
  },
}

export const TelegramBlockMeta = {
  tags: ['messaging', 'webhooks', 'automation'],
  url: 'https://telegram.org',
  templates: [
    {
      icon: TelegramIcon,
      title: 'Telegram alert relay',
      prompt:
        'Build a workflow that listens for critical alerts from Sentry or PagerDuty and forwards a concise summary with severity, link, and the on-call person to a Telegram group.',
      modules: ['agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['sentry', 'pagerduty'],
    },
    {
      icon: TelegramIcon,
      title: 'Telegram price-action notifier',
      prompt:
        'Create a scheduled workflow that watches tracked assets in a table for price thresholds and pushes a Telegram message with the trigger, price, and a link to the chart.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
    },
    {
      icon: TelegramIcon,
      title: 'Telegram support bot',
      prompt:
        'Build a Telegram bot that answers product questions using a knowledge base with citations, escalates to a human via Intercom when it cannot answer, and logs every conversation to a table.',
      modules: ['knowledge-base', 'tables', 'agent', 'workflows'],
      category: 'support',
      tags: ['support', 'communication'],
      alsoIntegrations: ['intercom'],
    },
    {
      icon: TelegramIcon,
      title: 'Telegram daily standup poller',
      prompt:
        'Create a scheduled workflow that posts a daily standup prompt to a Telegram group, collects the replies, and writes a structured standup digest to a Google Doc.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['team', 'reporting'],
      alsoIntegrations: ['google_docs'],
    },
    {
      icon: TelegramIcon,
      title: 'Telegram broadcast scheduler',
      prompt:
        'Build a workflow that reads a tables-based content calendar and posts scheduled Telegram channel messages with formatted text, images, and links at the right time.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'marketing',
      tags: ['marketing', 'automation'],
    },
    {
      icon: TelegramIcon,
      title: 'Telegram form-reply collector',
      prompt:
        'Create a workflow that asks structured questions in Telegram one at a time, parses replies into fields, and saves the completed response as a row in a Sim table.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'communication'],
    },
    {
      icon: TelegramIcon,
      title: 'Telegram + WhatsApp dual-channel notifier',
      prompt:
        'Build a workflow that sends critical operational alerts via both Telegram and WhatsApp based on user preference per recipient, and writes delivery status to a table.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['communication', 'monitoring'],
      alsoIntegrations: ['whatsapp'],
    },
  ],
  skills: [
    {
      name: 'send-alert-message',
      description: 'Post a formatted alert or notification to a Telegram chat or channel.',
      content:
        '# Send a Telegram Alert\n\nDeliver a timely notification to a Telegram chat, group, or channel.\n\n## Steps\n1. Use the Send Message operation with your Bot Token and the target Chat ID.\n2. Compose the Message with the essentials up front: what happened, severity, and a link for follow-up.\n3. To find a Chat ID, add the bot to the chat, send a message, then read the chat field from the getUpdates response.\n4. For recurring alerts, build the message from upstream block outputs so each notification carries live context.\n\n## Output\nReturn the sent message ID and chat ID so the run can be traced or the message later deleted.',
    },
    {
      name: 'send-media-message',
      description:
        'Send a photo, video, document, or audio file to a Telegram chat with a caption.',
      content:
        '# Send Media to Telegram\n\nDeliver a file such as a chart, report, or image to a Telegram chat.\n\n## Steps\n1. Pick the matching operation: Send Photo, Send Video, Send Audio, Send Animation, or Send Document.\n2. Provide the Bot Token and Chat ID.\n3. Upload the file directly, or reference a file produced by a previous block (for example a generated PDF or chart image).\n4. Add an optional Caption describing the attachment.\n\n## Output\nConfirm delivery and return the message ID so the media post can be referenced later.',
    },
    {
      name: 'route-incoming-message',
      description: 'Trigger a workflow when a Telegram message arrives and act on its content.',
      content:
        '# Route an Incoming Telegram Message\n\nUse Telegram as a trigger so the workflow runs whenever a user messages the bot.\n\n## Steps\n1. Enable the Telegram webhook trigger so incoming messages start the workflow.\n2. Read the trigger outputs: text, from_username, chat_id, and chat_type.\n3. Branch on the message content (for example detect a command or a support question) to decide the next action.\n4. Reply with the Send Message operation using the chat_id from the trigger.\n\n## Output\nReturn the parsed incoming message fields and confirm the reply that was sent back to the user.',
    },
    {
      name: 'run-a-poll',
      description: 'Post a poll to a Telegram chat to collect a quick vote from members.',
      content:
        '# Run a Telegram Poll\n\nGather a fast decision or sentiment check from a chat or channel.\n\n## Steps\n1. Use the Send Poll operation with your Bot Token and the target Chat ID.\n2. Set the Poll Question and add one answer option per line (2-10 options).\n3. In advanced settings, choose whether the poll is anonymous and whether multiple answers are allowed.\n4. Send the poll, then read replies from the chat to act on the outcome.\n\n## Output\nReturn the sent message ID so the poll post can be referenced or pinned later.',
    },
    {
      name: 'pin-and-react-to-messages',
      description: 'Pin an important message and add an emoji reaction in a Telegram chat.',
      content:
        '# Pin and React to a Telegram Message\n\nHighlight a key message and acknowledge it with a reaction.\n\n## Steps\n1. Capture the message ID to act on, for example from the Send Message output or the incoming message trigger.\n2. Use the Pin Message operation with the Bot Token, Chat ID, and Message ID to pin it for the whole chat.\n3. Use the Set Message Reaction operation with an emoji to acknowledge a message, or send an empty reaction to remove one.\n4. Use the Unpin Message operation later to clear the pinned message when it is no longer relevant.\n\n## Output\nConfirm the pin and reaction succeeded so the chat keeps the important context surfaced.',
    },
  ],
} as const satisfies BlockMeta
