import { MicrosoftTeamsIcon } from '@/components/icons'
import type { TriggerConfig } from '@/triggers/types'

export const microsoftTeamsChatSubscriptionTrigger: TriggerConfig = {
  id: 'microsoftteams_chat_subscription',
  name: 'Microsoft Teams Chat',
  provider: 'microsoft-teams',
  description:
    'Trigger workflows from Microsoft Teams chat message notifications via Microsoft Graph subscriptions. Notifications share a seven-day deduplication window keyed by subscription and message ID, so later edits may not start a separate run.',
  version: '1.0.0',
  icon: MicrosoftTeamsIcon,

  subBlocks: [
    {
      id: 'triggerCredentials',
      title: 'Credentials',
      type: 'oauth-input',
      description: 'This trigger requires microsoft teams credentials to access your account.',
      serviceId: 'microsoft-teams',
      requiredScopes: [
        'openid',
        'profile',
        'email',
        'User.Read',
        'Chat.Read',
        'Chat.ReadWrite',
        'Chat.ReadBasic',
        'ChatMessage.Send',
        'Channel.ReadBasic.All',
        'ChannelMessage.Send',
        'ChannelMessage.Read.All',
        'ChannelMessage.ReadWrite',
        'ChannelMember.Read.All',
        'Group.Read.All',
        'Group.ReadWrite.All',
        'Team.ReadBasic.All',
        'TeamMember.Read.All',
        'offline_access',
        'Files.Read',
        'Sites.Read.All',
      ],
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'microsoftteams_chat_subscription',
      },
    },
    {
      id: 'triggerChatId',
      title: 'Chat ID',
      /* "Runs on … in a chat ID" reads as form scaffolding; the card wants the thing. */
      canvasNoun: 'a chat',
      type: 'short-input',
      placeholder: 'Enter chat ID',
      description: 'The ID of the Teams chat to monitor',
      required: true,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'microsoftteams_chat_subscription',
      },
    },
    {
      id: 'includeAttachments',
      title: 'Include Attachments',
      type: 'switch',
      defaultValue: true,
      description: 'Fetch hosted contents and upload to storage',
      required: false,
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'microsoftteams_chat_subscription',
      },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: [
        'Connect your Microsoft Teams account and grant the required permissions.',
        'Enter the Chat ID of the Teams chat you want to monitor.',
        'We will create a Microsoft Graph change notification subscription that delivers chat message events to your Sim webhook URL.',
      ]
        .map(
          (instruction, index) =>
            `<div class="mb-3"><strong>${index + 1}.</strong> ${instruction}</div>`
        )
        .join(''),
      mode: 'trigger',
      condition: {
        field: 'selectedTriggerId',
        value: 'microsoftteams_chat_subscription',
      },
    },
  ],

  outputs: {
    message_id: { type: 'string', description: 'Message ID' },
    chat_id: { type: 'string', description: 'Chat ID' },
    from_name: { type: 'string', description: 'Sender display name' },
    text: { type: 'string', description: 'Message body (HTML or text)' },
    created_at: { type: 'string', description: 'Message timestamp' },
    attachments: { type: 'file[]', description: 'Uploaded attachments as files' },
    change_type: {
      type: 'string',
      description: 'Graph change type that fired the notification: created or updated',
    },
    from_id: { type: 'string', description: 'Sender user or application (bot) ID' },
    from_type: { type: 'string', description: 'Sender kind: user, application, or device' },
    from_identity: {
      type: 'json',
      description:
        'Sender identity set: user, application (bot), or device, each with id and displayName',
    },
    message_type: {
      type: 'string',
      description: 'Graph message type (message, systemEventMessage)',
    },
    content_type: { type: 'string', description: 'Body content type: text or html' },
    subject: { type: 'string', description: 'Message subject' },
    importance: { type: 'string', description: 'Message importance: normal, high, or urgent' },
    web_url: { type: 'string', description: 'Link to the message in Teams' },
    last_modified_at: {
      type: 'string',
      description: 'When the message or its reactions last changed',
    },
    last_edited_at: { type: 'string', description: 'When the message was last edited' },
    deleted_at: { type: 'string', description: 'When the message was deleted' },
    mentions: {
      type: 'json',
      description: 'Mentioned entities: id, mentionText, mentioned (user/application/...)',
    },
    reactions: {
      type: 'json',
      description: 'Reactions: reactionType, displayName, createdDateTime, userId, userDisplayName',
    },
    attachment_metadata: {
      type: 'json',
      description: 'Attachment references from Graph (id, contentType, contentUrl, name)',
    },
  },

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
