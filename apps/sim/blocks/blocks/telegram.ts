import { TelegramIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { TelegramResponse } from '@/tools/telegram/types'

export const TelegramBlock: BlockConfig<TelegramResponse> = {
  type: 'telegram',
  name: 'Telegram',
  description: 'Interact with Telegram',
  authMode: AuthMode.BotToken,
  longDescription:
    'Integrate Telegram into the workflow. Can send and delete messages. Can be used in trigger mode to trigger a workflow when a message is sent to a chat.',
  docsLink: 'https://docs.sim.ai/tools/telegram',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: TelegramIcon,
  triggerAllowed: true,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      layout: 'full',
      options: [
        { label: 'Send Message', id: 'telegram_send_message' },
        { label: 'Send Photo', id: 'telegram_send_photo' },
        { label: 'Send Video', id: 'telegram_send_video' },
        { label: 'Send Audio', id: 'telegram_send_audio' },
        { label: 'Send Animation', id: 'telegram_send_animation' },
        { label: 'Delete Message', id: 'telegram_delete_message' },
      ],
      value: () => 'telegram_send_message',
    },
    {
      id: 'botToken',
      title: 'Bot Token',
      type: 'short-input',
      layout: 'full',
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
      layout: 'full',
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
      layout: 'full',
      placeholder: 'Enter the message to send',
      condition: { field: 'operation', value: 'telegram_send_message' },
    },
    {
      id: 'photo',
      title: 'Photo',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter photo URL or file_id',
      description: 'Photo to send. Pass a file_id or HTTP URL',
      condition: { field: 'operation', value: 'telegram_send_photo' },
    },
    {
      id: 'caption',
      title: 'Caption',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter optional caption',
      description: 'Photo caption (optional)',
      condition: { field: 'operation', value: 'telegram_send_photo' },
    },
    {
      id: 'video',
      title: 'Video',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter video URL or file_id',
      description: 'Video to send. Pass a file_id or HTTP URL',
      condition: { field: 'operation', value: 'telegram_send_video' },
    },
    {
      id: 'videoCaption',
      title: 'Caption',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter optional caption',
      description: 'Video caption (optional)',
      condition: { field: 'operation', value: 'telegram_send_video' },
    },
    {
      id: 'audio',
      title: 'Audio',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter audio URL or file_id',
      description: 'Audio file to send. Pass a file_id or HTTP URL',
      condition: { field: 'operation', value: 'telegram_send_audio' },
    },
    {
      id: 'audioCaption',
      title: 'Caption',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter optional caption',
      description: 'Audio caption (optional)',
      condition: { field: 'operation', value: 'telegram_send_audio' },
    },
    {
      id: 'animation',
      title: 'Animation',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter animation URL or file_id',
      description: 'Animation (GIF) to send. Pass a file_id or HTTP URL',
      condition: { field: 'operation', value: 'telegram_send_animation' },
    },
    {
      id: 'animationCaption',
      title: 'Caption',
      type: 'long-input',
      layout: 'full',
      placeholder: 'Enter optional caption',
      description: 'Animation caption (optional)',
      condition: { field: 'operation', value: 'telegram_send_animation' },
    },
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      layout: 'full',
      placeholder: 'Enter the message ID to delete',
      description: 'The unique identifier of the message you want to delete',
      condition: { field: 'operation', value: 'telegram_delete_message' },
    },
    // TRIGGER MODE: Trigger configuration (only shown when trigger mode is active)
    {
      id: 'triggerConfig',
      title: 'Trigger Configuration',
      type: 'trigger-config',
      layout: 'full',
      triggerProvider: 'telegram',
      availableTriggers: ['telegram_webhook'],
    },
  ],
  tools: {
    access: [
      'telegram_send_message',
      'telegram_delete_message',
      'telegram_send_photo',
      'telegram_send_video',
      'telegram_send_audio',
      'telegram_send_animation',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'telegram_send_message':
            return 'telegram_send_message'
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
          default:
            return 'telegram_send_message'
        }
      },
      params: (params) => {
        const commonParams: Record<string, any> = {}

        if (!params.botToken) throw new Error('Bot token required for this operation')
        commonParams.botToken = params.botToken

        const chatId = (params.chatId || '').trim()
        if (!chatId) {
          throw new Error('Chat ID is required.')
        }

        switch (params.operation) {
          case 'telegram_send_message':
            return {
              ...commonParams,
              chatId,
              text: params.text,
            }
          case 'telegram_delete_message':
            if (!params.messageId) {
              throw new Error('Message ID is required for delete operation.')
            }
            return {
              ...commonParams,
              chatId,
              messageId: params.messageId,
            }
          case 'telegram_send_photo':
            if (!params.photo) {
              throw new Error('Photo URL or file_id is required.')
            }
            return {
              ...commonParams,
              chatId,
              photo: params.photo,
              caption: params.caption,
            }
          case 'telegram_send_video':
            if (!params.video) {
              throw new Error('Video URL or file_id is required.')
            }
            return {
              ...commonParams,
              chatId,
              video: params.video,
              caption: params.videoCaption,
            }
          case 'telegram_send_audio':
            if (!params.audio) {
              throw new Error('Audio URL or file_id is required.')
            }
            return {
              ...commonParams,
              chatId,
              audio: params.audio,
              caption: params.audioCaption,
            }
          case 'telegram_send_animation':
            if (!params.animation) {
              throw new Error('Animation URL or file_id is required.')
            }
            return {
              ...commonParams,
              chatId,
              animation: params.animation,
              caption: params.animationCaption,
            }
          default:
            return {
              ...commonParams,
              chatId,
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
    photo: { type: 'string', description: 'Photo URL or file_id' },
    video: { type: 'string', description: 'Video URL or file_id' },
    audio: { type: 'string', description: 'Audio URL or file_id' },
    animation: { type: 'string', description: 'Animation URL or file_id' },
    caption: { type: 'string', description: 'Caption for media' },
    videoCaption: { type: 'string', description: 'Caption for video' },
    audioCaption: { type: 'string', description: 'Caption for audio' },
    animationCaption: { type: 'string', description: 'Caption for animation' },
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
