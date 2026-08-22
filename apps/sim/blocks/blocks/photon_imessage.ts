import { PhotonIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import { getTrigger } from '@/triggers'

/**
 * Operation groups drive every `condition`/`required` below. A send-style operation targets
 * either a new/existing DM by address (`to`) or an existing chat by GUID; a group operation can
 * only be addressed by GUID because Photon has no by-id resolver for a group it has not seen.
 */
const CHAT_TARGET_OPS = [
  'send_message',
  'send_media',
  'send_voice_memo',
  'send_reaction',
  'edit_message',
  'unsend_message',
  'create_poll',
  'set_typing',
  'mark_read',
  'share_contact_card',
  'set_chat_background',
] as const

const CHAT_ID_ONLY_OPS = [
  'rename_chat',
  'set_group_avatar',
  'add_participant',
  'remove_participant',
  'leave_chat',
  'get_group_info',
  'get_message',
] as const

const MESSAGE_ID_OPS = [
  'send_reaction',
  'edit_message',
  'unsend_message',
  'mark_read',
  'get_message',
] as const

const FILE_OPS = [
  'send_media',
  'send_voice_memo',
  'set_group_avatar',
  'set_chat_background',
] as const

const CLEARABLE_OPS = ['set_group_avatar', 'set_chat_background'] as const

const PARTICIPANT_OPS = ['add_participant', 'remove_participant'] as const

const splitHandles = (value: unknown): string[] =>
  typeof value === 'string'
    ? value
        .split(/[\n,]/)
        .map((handle) => handle.trim())
        .filter(Boolean)
    : []

/** The unified target field: an address for DMs, or a chat GUID from a trigger. */
const RECIPIENT_FIELD = 'to'

export const PhotonImessageBlock: BlockConfig = {
  type: 'photon_imessage',
  name: 'iMessage (Photon)',
  description: 'Send and receive iMessage',
  longDescription:
    'Send iMessages from a Photon-managed number and trigger workflows on inbound messages, tapbacks, and read receipts. Photon runs the iMessage line, so no Mac is required. Beyond text, workflows can send media and voice memos, react with tapbacks, edit and unsend messages, run native polls, manage group chats, and download received attachments.',
  docsLink: 'https://docs.sim.ai/integrations/photon_imessage',
  category: 'tools',
  integrationType: IntegrationType.Communication,
  bgColor: '#0B84FE',
  icon: PhotonIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'iMessage',
    /*
     * Four triggers share one picker; the chip carries which event was chosen. The sender
     * allowlist is the only scope and stays optional — empty means every sender, so a
     * placeholder noun there would claim the opposite.
     */
    triggerSentences: {
      default: [
        'Run on',
        { field: 'selectedTriggerId', core: true },
        { text: 'from', field: 'triggerSenderAllowlist' },
      ],
    },
    sentences: {
      byOperation: {
        send_message: [
          { text: 'Send', field: 'text', core: true },
          { text: 'to', field: RECIPIENT_FIELD, core: true },
          { text: 'with', field: 'effectName' },
        ],
        send_media: [
          { text: 'Send a file to', field: RECIPIENT_FIELD, core: true },
          { text: ', captioned', field: 'caption' },
        ],
        send_voice_memo: [{ text: 'Send a voice memo to', field: RECIPIENT_FIELD, core: true }],
        send_reaction: [
          { text: 'React', field: 'emoji', core: true },
          { text: 'to message', field: 'messageId', core: true },
        ],
        edit_message: [
          { text: 'Edit message', field: 'messageId', core: true },
          { text: 'to say', field: 'editText', core: true },
        ],
        unsend_message: [{ text: 'Unsend message', field: 'messageId', core: true }],
        create_poll: [
          { text: 'Poll', field: 'pollTitle', core: true },
          { text: 'in', field: RECIPIENT_FIELD, core: true },
        ],
        set_typing: [
          { text: 'Turn typing', field: 'typingState', core: true },
          { text: 'in', field: RECIPIENT_FIELD },
        ],
        mark_read: [{ text: 'Mark message', field: 'messageId', after: 'as read', core: true }],
        create_group: [
          { text: 'Start a group with', field: 'handles', core: true },
          { text: ', opening with', field: 'initialText' },
        ],
        rename_chat: [
          { text: 'Rename chat', field: 'chatId', core: true },
          { text: 'to', field: 'displayName', core: true },
        ],
        set_group_avatar: [{ text: 'Set the photo of chat', field: 'chatId', core: true }],
        add_participant: [
          { text: 'Add', field: 'handle', core: true },
          { text: 'to chat', field: 'chatId', core: true },
        ],
        remove_participant: [
          { text: 'Remove', field: 'handle', core: true },
          { text: 'from chat', field: 'chatId', core: true },
        ],
        leave_chat: [{ text: 'Leave chat', field: 'chatId', core: true }],
        get_group_info: [
          { text: 'Fetch the name and members of chat', field: 'chatId', core: true },
        ],
        get_message: [{ text: 'Fetch message', field: 'messageId', core: true }],
        download_attachment: [{ text: 'Download attachment', field: 'attachmentId', core: true }],
        share_contact_card: [
          { text: 'Share the contact card with', field: RECIPIENT_FIELD, core: true },
        ],
        set_chat_background: [
          { text: 'Set the background of', field: RECIPIENT_FIELD, core: true },
        ],
      },
    },
  },

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Conversation
        { label: 'Send Message', id: 'send_message' },
        { label: 'Send Media', id: 'send_media' },
        { label: 'Send Voice Memo', id: 'send_voice_memo' },
        { label: 'Send Tapback', id: 'send_reaction' },
        { label: 'Create Poll', id: 'create_poll' },
        { label: 'Typing Indicator', id: 'set_typing' },
        { label: 'Mark as Read', id: 'mark_read' },
        // Messages
        { label: 'Edit Message', id: 'edit_message' },
        { label: 'Unsend Message', id: 'unsend_message' },
        { label: 'Get Message', id: 'get_message' },
        { label: 'Download Attachment', id: 'download_attachment' },
        // Groups
        { label: 'Create Group Chat', id: 'create_group' },
        { label: 'Rename Group Chat', id: 'rename_chat' },
        { label: 'Set Group Photo', id: 'set_group_avatar' },
        { label: 'Add Participant', id: 'add_participant' },
        { label: 'Remove Participant', id: 'remove_participant' },
        { label: 'Leave Group Chat', id: 'leave_chat' },
        { label: 'Get Group Info', id: 'get_group_info' },
        // Presence
        { label: 'Share Contact Card', id: 'share_contact_card' },
        { label: 'Set Chat Background', id: 'set_chat_background' },
      ],
      value: () => 'send_message',
    },
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'Your Photon project ID',
      description: 'Found in your project settings at app.photon.codes.',
      password: true,
      paramVisibility: 'user-only',
      required: true,
    },
    {
      id: 'projectSecret',
      title: 'Project Secret',
      type: 'short-input',
      placeholder: 'Your Photon project secret',
      description:
        'Authorizes Photon API access. This is a different credential from the webhook signing secret used by the trigger.',
      password: true,
      paramVisibility: 'user-only',
      required: true,
    },
    {
      id: 'to',
      title: 'To',
      type: 'short-input',
      placeholder: 'e.g. +14155551234, name@example.com, or a chat ID from a trigger',
      description:
        'A phone number in E.164 form or an Apple ID email starts or reuses a direct conversation. A chat ID from an iMessage trigger targets that exact conversation, and is the only way to reach a group chat.',
      condition: { field: 'operation', value: [...CHAT_TARGET_OPS] },
      required: { field: 'operation', value: [...CHAT_TARGET_OPS] },
    },
    {
      id: 'chatId',
      title: 'Chat ID',
      type: 'short-input',
      placeholder: 'e.g. the chatId from an iMessage trigger',
      description: 'Group chat GUID this operation manages.',
      condition: { field: 'operation', value: [...CHAT_ID_ONLY_OPS] },
      required: { field: 'operation', value: [...CHAT_ID_ONLY_OPS] },
    },
    {
      id: 'text',
      title: 'Message',
      type: 'long-input',
      placeholder: 'Message to send',
      description: 'iMessage is plain text, so Markdown is not rendered.',
      condition: { field: 'operation', value: 'send_message' },
      required: { field: 'operation', value: 'send_message' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a friendly, concise message body suitable for iMessage. Return ONLY the message text - no explanations, no extra text.',
        placeholder: 'Describe the message purpose and tone...',
      },
    },
    {
      id: 'effectName',
      title: 'Effect',
      type: 'dropdown',
      options: [
        { label: 'None', id: '' },
        { label: 'Balloons', id: 'balloons' },
        { label: 'Celebration', id: 'celebration' },
        { label: 'Confetti', id: 'confetti' },
        { label: 'Echo', id: 'echo' },
        { label: 'Fireworks', id: 'fireworks' },
        { label: 'Gentle', id: 'gentle' },
        { label: 'Heart', id: 'heart' },
        { label: 'Invisible Ink', id: 'invisible' },
        { label: 'Lasers', id: 'lasers' },
        { label: 'Loud', id: 'loud' },
        { label: 'Slam', id: 'slam' },
        { label: 'Sparkles', id: 'sparkles' },
        { label: 'Spotlight', id: 'spotlight' },
      ],
      condition: { field: 'operation', value: 'send_message' },
      mode: 'advanced',
    },
    {
      id: 'replyToMessageId',
      title: 'Reply To Message ID',
      type: 'short-input',
      placeholder: 'Send as an inline reply to this message (optional)',
      condition: { field: 'operation', value: 'send_message' },
      mode: 'advanced',
    },
    {
      id: 'messageId',
      title: 'Message ID',
      type: 'short-input',
      placeholder: 'e.g. the messageId from an iMessage trigger',
      condition: { field: 'operation', value: [...MESSAGE_ID_OPS] },
      required: { field: 'operation', value: [...MESSAGE_ID_OPS] },
    },
    {
      id: 'emoji',
      title: 'Tapback',
      type: 'short-input',
      placeholder: 'e.g. ❤️ 👍 👎 😂 ‼️ ❓ or any emoji',
      description:
        'The six classic tapbacks map to native reactions; any other emoji sends a custom emoji tapback.',
      condition: { field: 'operation', value: 'send_reaction' },
      required: { field: 'operation', value: 'send_reaction' },
    },
    {
      id: 'editText',
      title: 'New Text',
      type: 'long-input',
      placeholder: 'Replacement text for the message',
      condition: { field: 'operation', value: 'edit_message' },
      required: { field: 'operation', value: 'edit_message' },
    },
    {
      id: 'pollTitle',
      title: 'Poll Question',
      type: 'short-input',
      placeholder: 'e.g. Where should we get lunch?',
      condition: { field: 'operation', value: 'create_poll' },
      required: { field: 'operation', value: 'create_poll' },
    },
    {
      id: 'pollOptions',
      title: 'Poll Options',
      type: 'long-input',
      placeholder: 'One option per line (2-10 options)',
      condition: { field: 'operation', value: 'create_poll' },
      required: { field: 'operation', value: 'create_poll' },
    },
    {
      id: 'typingState',
      title: 'Typing State',
      type: 'dropdown',
      options: [
        { label: 'Start typing', id: 'start' },
        { label: 'Stop typing', id: 'stop' },
      ],
      value: () => 'start',
      condition: { field: 'operation', value: 'set_typing' },
    },
    {
      id: 'handles',
      title: 'Participants',
      type: 'long-input',
      placeholder: 'Comma or newline separated (e.g. +15551234567, name@icloud.com)',
      description: 'At least 2 participants. Group creation requires a dedicated Photon line.',
      condition: { field: 'operation', value: 'create_group' },
      required: { field: 'operation', value: 'create_group' },
      canvasNoun: 'participants',
    },
    {
      id: 'initialText',
      title: 'First Message',
      type: 'long-input',
      placeholder: 'Message to open the group with (optional)',
      condition: { field: 'operation', value: 'create_group' },
      mode: 'advanced',
    },
    {
      id: 'displayName',
      title: 'New Name',
      type: 'short-input',
      placeholder: 'e.g. Weekend Plans',
      condition: { field: 'operation', value: 'rename_chat' },
      required: { field: 'operation', value: 'rename_chat' },
    },
    {
      id: 'handle',
      title: 'Participant',
      type: 'short-input',
      placeholder: 'e.g. +15551234567 or name@icloud.com',
      condition: { field: 'operation', value: [...PARTICIPANT_OPS] },
      required: { field: 'operation', value: [...PARTICIPANT_OPS] },
      canvasNoun: 'a participant',
    },
    {
      id: 'attachmentId',
      title: 'Attachment ID',
      type: 'short-input',
      placeholder: 'e.g. an attachment id from an iMessage trigger',
      condition: { field: 'operation', value: 'download_attachment' },
      required: { field: 'operation', value: 'download_attachment' },
    },
    {
      id: 'imageAction',
      title: 'Image',
      type: 'dropdown',
      options: [
        { label: 'Upload an image', id: 'set' },
        { label: 'Remove current', id: 'clear' },
      ],
      value: () => 'set',
      condition: { field: 'operation', value: [...CLEARABLE_OPS] },
    },
    {
      id: 'uploadFile',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload a file (max 100MB)',
      multiple: false,
      condition: { field: 'operation', value: [...FILE_OPS] },
      mode: 'basic',
    },
    {
      id: 'fileRef',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference a file from a previous block (e.g. {{block.output.file}})',
      condition: { field: 'operation', value: [...FILE_OPS] },
      mode: 'advanced',
    },
    {
      id: 'mediaFilename',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Override the file name (optional)',
      condition: { field: 'operation', value: [...FILE_OPS] },
      mode: 'advanced',
    },
    {
      id: 'mediaContentType',
      title: 'Content Type',
      type: 'short-input',
      placeholder: 'Override the MIME type (optional)',
      condition: { field: 'operation', value: [...FILE_OPS] },
      mode: 'advanced',
    },
    {
      id: 'caption',
      title: 'Caption',
      type: 'long-input',
      placeholder: 'Text sent right after the media (optional)',
      condition: { field: 'operation', value: 'send_media' },
      mode: 'advanced',
    },
    ...getTrigger('photon_imessage_message_received').subBlocks,
    ...getTrigger('photon_imessage_reaction_received').subBlocks,
    ...getTrigger('photon_imessage_read_receipt').subBlocks,
    ...getTrigger('photon_imessage_webhook').subBlocks,
  ],

  tools: {
    access: [
      'photon_imessage_send_message',
      'photon_imessage_send_media',
      'photon_imessage_send_voice_memo',
      'photon_imessage_send_reaction',
      'photon_imessage_edit_message',
      'photon_imessage_unsend_message',
      'photon_imessage_create_poll',
      'photon_imessage_set_typing',
      'photon_imessage_mark_read',
      'photon_imessage_create_group',
      'photon_imessage_rename_chat',
      'photon_imessage_set_group_avatar',
      'photon_imessage_add_participant',
      'photon_imessage_remove_participant',
      'photon_imessage_leave_chat',
      'photon_imessage_get_group_info',
      'photon_imessage_get_message',
      'photon_imessage_download_attachment',
      'photon_imessage_share_contact_card',
      'photon_imessage_set_chat_background',
    ],
    config: {
      tool: (params) => `photon_imessage_${params.operation || 'send_message'}`,
      params: (params) => {
        const {
          operation,
          to,
          chatId,
          editText,
          pollTitle,
          pollOptions,
          typingState,
          handles,
          imageAction,
          file,
          mediaFilename,
          mediaContentType,
          effectName,
          replyToMessageId,
          initialText,
          caption,
          ...rest
        } = params

        const mapped: Record<string, unknown> = { ...rest }

        if (to !== undefined && to !== '') mapped.to = to
        if (chatId !== undefined && chatId !== '') mapped.chatId = chatId

        switch (operation) {
          case 'edit_message':
            mapped.text = editText
            break
          case 'create_poll':
            mapped.title = pollTitle
            mapped.options = splitHandles(pollOptions)
            break
          case 'set_typing':
            mapped.state = typingState || 'start'
            break
          case 'create_group':
            mapped.handles = splitHandles(handles)
            if (initialText !== undefined && initialText !== '') mapped.initialText = initialText
            break
          default:
            break
        }

        if (operation === 'send_message') {
          if (effectName !== undefined && effectName !== '') mapped.effectName = effectName
          if (replyToMessageId !== undefined && replyToMessageId !== '') {
            mapped.replyToMessageId = replyToMessageId
          }
        }

        if (operation === 'send_media' && caption !== undefined && caption !== '') {
          mapped.caption = caption
        }

        if ((FILE_OPS as readonly string[]).includes(operation)) {
          if ((CLEARABLE_OPS as readonly string[]).includes(operation) && imageAction === 'clear') {
            mapped.clear = true
          } else {
            const normalizedFile = normalizeFileInput(file, { single: true })
            if (normalizedFile) {
              mapped.file = normalizedFile
            }
            if (mediaFilename !== undefined && mediaFilename !== '') {
              mapped.filename = mediaFilename
            }
            if (mediaContentType !== undefined && mediaContentType !== '') {
              mapped.contentType = mediaContentType
            }
          }
        }

        return mapped
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    projectId: { type: 'string', description: 'Photon project ID' },
    projectSecret: { type: 'string', description: 'Photon project secret' },
    to: {
      type: 'string',
      description: 'Phone number, Apple ID email, or a chat ID from a trigger',
    },
    chatId: { type: 'string', description: 'Group chat GUID for group management operations' },
    text: { type: 'string', description: 'Message text to send' },
    effectName: { type: 'string', description: 'iMessage screen or bubble effect' },
    replyToMessageId: { type: 'string', description: 'Message ID to reply to inline' },
    messageId: { type: 'string', description: 'Message ID to act on' },
    emoji: { type: 'string', description: 'Tapback emoji' },
    editText: { type: 'string', description: 'Replacement text when editing' },
    pollTitle: { type: 'string', description: 'Poll question' },
    pollOptions: { type: 'string', description: 'Poll options, one per line' },
    typingState: { type: 'string', description: 'Typing indicator state (start or stop)' },
    handles: { type: 'string', description: 'Participants for a new group chat' },
    initialText: { type: 'string', description: 'First message of a new group chat' },
    displayName: { type: 'string', description: 'New group chat name' },
    handle: { type: 'string', description: 'Participant to add or remove' },
    attachmentId: { type: 'string', description: 'Attachment ID to download' },
    imageAction: { type: 'string', description: 'Whether to set or clear the image' },
    file: { type: 'json', description: 'File to send or set' },
    filename: { type: 'string', description: 'File name override' },
    contentType: { type: 'string', description: 'MIME type override' },
    caption: { type: 'string', description: 'Caption sent after media' },
  },

  outputs: {
    // Send-style operations
    messageId: { type: 'string', description: 'Identifier of the sent or affected message' },
    chatId: {
      type: 'string',
      description: 'Chat GUID the operation ran in. Pass this back to target the same chat.',
    },
    timestamp: { type: 'string', description: 'ISO 8601 time of the operation' },
    state: { type: 'string', description: 'Resulting typing indicator state' },
    displayName: { type: 'string', description: 'Group name (rename and group info)' },
    cleared: { type: 'boolean', description: 'True when an image was removed rather than set' },
    handle: { type: 'string', description: 'Participant handle that was added or removed' },
    // Reads
    text: { type: 'string', description: 'Message text (get message)' },
    contentType: { type: 'string', description: 'Content arm of the message (get message)' },
    senderId: { type: 'string', description: 'Sender handle (get message)' },
    attachments: { type: 'json', description: 'Attachment metadata (get message)' },
    members: { type: 'json', description: 'Group member handles (group info)' },
    // Attachment download
    attachmentId: { type: 'string', description: 'The downloaded attachment ID' },
    fileName: { type: 'string', description: 'Downloaded file name' },
    mimeType: { type: 'string', description: 'Downloaded file MIME type' },
    sizeBytes: { type: 'number', description: 'Downloaded file size in bytes' },
    file: { type: 'json', description: 'The downloaded file, usable by downstream blocks' },
  },

  triggers: {
    enabled: true,
    available: [
      'photon_imessage_message_received',
      'photon_imessage_reaction_received',
      'photon_imessage_read_receipt',
      'photon_imessage_webhook',
    ],
  },
}

export const PhotonImessageBlockMeta = {
  tags: ['messaging', 'automation', 'webhooks'],
  url: 'https://photon.codes',
  templates: [
    {
      icon: PhotonIcon,
      title: 'iMessage support agent',
      prompt:
        'Build a workflow triggered when an iMessage is received that looks up the sender in the knowledge base, drafts an answer with an agent, and sends the reply back to the same chat.',
      modules: ['agent', 'knowledge-base', 'workflows'],
      category: 'support',
      tags: ['messaging', 'support', 'automation'],
    },
    {
      icon: PhotonIcon,
      title: 'iMessage appointment reminders',
      prompt:
        'Build a scheduled workflow that reads tomorrow’s appointments from a table each afternoon and texts every attendee a personalized iMessage reminder with the time and location.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['messaging', 'automation', 'scheduling'],
    },
    {
      icon: PhotonIcon,
      title: 'iMessage lead follow-up',
      prompt:
        'Build a workflow that fires when a new lead submits a form, drafts a short friendly intro with an agent, and sends it as an iMessage within seconds so reps reach leads while interest is high.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['messaging', 'sales', 'automation'],
      alsoIntegrations: ['typeform'],
    },
    {
      icon: PhotonIcon,
      title: 'iMessage escalation to Slack',
      prompt:
        'Build a workflow triggered when an iMessage is received that classifies sentiment, and posts the conversation to a Slack channel when a message reads as urgent or angry so a human can take over.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['messaging', 'support', 'escalation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: PhotonIcon,
      title: 'iMessage order updates',
      prompt:
        'Build a workflow that fires when an order status changes, formats a short status update, and sends it to the customer as an iMessage with a link to track the shipment.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['messaging', 'notifications', 'automation'],
    },
    {
      icon: PhotonIcon,
      title: 'iMessage group poll coordinator',
      prompt:
        'Build a workflow that creates a native iMessage poll in a group chat to pick a meeting time, watches the chat for replies, and posts the winning option back to the group once everyone has voted.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['messaging', 'automation', 'scheduling'],
    },
    {
      icon: PhotonIcon,
      title: 'iMessage attachment intake',
      prompt:
        'Build a workflow triggered when an iMessage with an attachment arrives that downloads the file, extracts the contents with an agent, and appends the structured result to a table.',
      modules: ['agent', 'tables', 'workflows'],
      category: 'operations',
      tags: ['messaging', 'automation', 'documents'],
    },
  ],
  skills: [
    {
      name: 'send-tailored-imessage',
      description:
        'Send a personalized iMessage to a recipient, optionally as a threaded reply or with a screen effect.',
      content:
        '# Send Tailored iMessage\n\nReach a person on iMessage through a Photon-managed number.\n\n## Steps\n1. Draft a friendly, concise message tailored to the recipient. iMessage is plain text, so write without Markdown.\n2. Send Message with the recipient phone number or Apple ID email in To, or with the chat ID when continuing a known conversation.\n3. For a milestone or celebration, set an effect such as confetti or balloons; for a correction to an earlier message, prefer Edit Message instead of sending again.\n4. Reply to a specific earlier message by setting Reply To Message ID so the response threads inline.\n\n## Output\nThe message ID, the chat ID for follow-ups, and the send timestamp.',
    },
    {
      name: 'acknowledge-with-tapback',
      description:
        'React to an inbound iMessage with a fitting tapback, and follow up with a text reply when the message needs one.',
      content:
        '# Acknowledge with Tapback\n\nAcknowledge inbound messages the way a person would: with a tapback first, words second.\n\n## Steps\n1. Start from an iMessage Received trigger and read the inbound text and message ID.\n2. Pick a fitting reaction: a heart or thumbs up for good news or agreement, laugh for jokes, emphasize for urgent notes, a question mark when the request is unclear.\n3. Send Tapback with that emoji and the trigger message ID.\n4. When the message asks a question or needs action, follow with Send Message into the same chat ID.\n\n## Output\nThe reaction sent, and the reply message ID when one was needed.',
    },
    {
      name: 'run-imessage-poll',
      description:
        'Create a native iMessage poll in a conversation and report the choices offered.',
      content:
        '# Run iMessage Poll\n\nDecide something with a group using a native iMessage poll instead of counting reply messages.\n\n## Steps\n1. Write a short poll question and 2-10 answer options.\n2. Create Poll in the target chat — use the chat ID from a trigger for a group, or a phone number for a direct conversation.\n3. Announce the poll with Send Message so members know to vote.\n4. Watch subsequent deliveries on the Any Event trigger to react as votes arrive.\n\n## Output\nThe poll message ID, the chat ID, and the option list that was offered.',
    },
    {
      name: 'retract-mistaken-message',
      description:
        'Unsend a message that went to the wrong chat or contained an error, and send a correction when appropriate.',
      content:
        '# Retract Mistaken Message\n\nUndo a bad send the way iMessage users do: unsend it, then correct it.\n\n## Steps\n1. Identify the message ID of the mistaken send (from the send step output or Get Message).\n2. For a small typo in the right chat, prefer Edit Message with the corrected text.\n3. For a message that must disappear — wrong chat, wrong recipient, sensitive content — Unsend Message so it is retracted from the recipient device.\n4. When the conversation still needs the information, Send Message with the corrected version.\n\n## Output\nWhich message was retracted or edited, and the ID of the corrected message when one was sent.',
    },
    {
      name: 'process-imessage-attachments',
      description:
        'Download attachments from inbound iMessages and hand the files to downstream steps.',
      content:
        '# Process iMessage Attachments\n\nTurn photos and documents texted to the Photon number into files a workflow can use.\n\n## Steps\n1. Start from an iMessage Received trigger and read the attachments list — each entry carries an id, name, and MIME type, but no bytes.\n2. Download Attachment for each attachment ID to pull the bytes into the workflow as a file.\n3. Pass the file to the next step — extraction, storage, or classification.\n4. Confirm receipt to the sender with Send Tapback or a short Send Message into the same chat.\n\n## Output\nFor each attachment: the file name, MIME type, size, and the downloaded file.',
    },
    {
      name: 'steward-group-chat',
      description: 'Keep an iMessage group chat organized: name, photo, and membership.',
      content:
        '# Steward Group Chat\n\nManage an iMessage group the way an admin would.\n\n## Steps\n1. Get Group Info with the group chat ID to read the current name and member list.\n2. Rename Group Chat when the name no longer matches the purpose, and Set Group Photo to keep the group recognizable.\n3. Add Participant for newcomers and Remove Participant for departures, using phone numbers or Apple ID emails.\n4. Announce membership or name changes with Send Message so the group knows what happened, and Leave Group Chat when the line should exit entirely.\n\n## Output\nThe resulting group name and member list after the changes.',
    },
  ],
} as const satisfies BlockMeta
