import { TelegramIcon } from '@/components/icons'
import { TelegramBlockDisplay } from '@/blocks/blocks/telegram.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { TelegramResponse } from '@/tools/telegram/types'
import { getTrigger } from '@/triggers'

export const TelegramBlock: BlockConfig<TelegramResponse> = {
  ...TelegramBlockDisplay,
  authMode: AuthMode.BotToken,
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
        { label: 'Delete Message', id: 'telegram_delete_message' },
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
      required: true,
      condition: { field: 'operation', value: 'telegram_message' },
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
        ],
      },
    },
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'Enter the message ID to delete',
      description: 'The unique identifier of the message you want to delete',
      required: true,
      condition: { field: 'operation', value: 'telegram_delete_message' },
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
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'telegram_message':
            return 'telegram_message'
          case 'telegram_delete_message':
            return 'telegram_delete_message'
          case 'telegram_send_photo':
            return 'telegram_send_photo'
          case 'telegram_send_video':
            return 'telegram_send_video'
          case 'telegram_send_audio':
            return 'telegram_send_audio'
          case 'telegram_send_animation':
            return 'telegram_send_animation'
          case 'telegram_send_document':
            return 'telegram_send_document'
          default:
            return 'telegram_message'
        }
      },
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
            if (!params.messageId) {
              throw new Error('Message ID is required for delete operation.')
            }
            return {
              ...commonParams,
              messageId: params.messageId,
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
    messageId: { type: 'string', description: 'Message ID to delete' },
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
  ],
} as const satisfies BlockMeta
