export interface DiscordMessage {
  id: string
  content: string
  channel_id: string
  author: {
    id: string
    username: string
    avatar?: string
    bot: boolean
  }
  timestamp: string
  edited_timestamp?: string | null
  embeds: any[]
  attachments: any[]
  mentions: any[]
  mention_roles: string[]
  mention_everyone: boolean
}

export interface DiscordAPIError {
  code: number
  message: string
  errors?: Record<string, any>
}

export interface DiscordGuild {
  id: string
  name: string
  icon?: string
  description?: string
  owner_id: string
  roles: any[]
  channels?: any[]
  member_count?: number
}

export interface DiscordUser {
  id: string
  username: string
  discriminator: string
  avatar?: string
  bot?: boolean
  system?: boolean
  email?: string
  verified?: boolean
}

export interface DiscordAuthParams {
  botToken: string
  serverId: string
}

export interface DiscordSendMessageParams extends DiscordAuthParams {
  channelId: string
  content?: string
  embed?: {
    title?: string
    description?: string
    color?: string | number
  }
  files?: any[]
}

export interface DiscordGetMessagesParams extends DiscordAuthParams {
  channelId: string
  limit?: number
}

export interface DiscordGetServerParams extends Omit<DiscordAuthParams, 'serverId'> {
  serverId: string
}

export interface DiscordGetUserParams extends Omit<DiscordAuthParams, 'serverId'> {
  userId: string
}

interface BaseDiscordResponse {
  success: boolean
  output: Record<string, any>
  error?: string
}

export interface DiscordSendMessageResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: DiscordMessage
  }
}

export interface DiscordGetMessagesResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: {
      messages: DiscordMessage[]
      channel_id: string
    }
  }
}

export interface DiscordGetServerResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: DiscordGuild
  }
}

export interface DiscordGetUserResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: DiscordUser
  }
}

// Message operations
export interface DiscordEditMessageParams extends DiscordAuthParams {
  channelId: string
  messageId: string
  content?: string
}

export interface DiscordEditMessageResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: DiscordMessage
  }
}

export interface DiscordDeleteMessageParams extends DiscordAuthParams {
  channelId: string
  messageId: string
}

export interface DiscordDeleteMessageResponse extends BaseDiscordResponse {
  output: {
    message: string
  }
}

export interface DiscordAddReactionParams extends DiscordAuthParams {
  channelId: string
  messageId: string
  emoji: string
}

export interface DiscordAddReactionResponse extends BaseDiscordResponse {
  output: {
    message: string
  }
}

export interface DiscordRemoveReactionParams extends DiscordAuthParams {
  channelId: string
  messageId: string
  emoji: string
  userId?: string
}

export interface DiscordRemoveReactionResponse extends BaseDiscordResponse {
  output: {
    message: string
  }
}

export interface DiscordPinMessageParams extends DiscordAuthParams {
  channelId: string
  messageId: string
}

export interface DiscordPinMessageResponse extends BaseDiscordResponse {
  output: {
    message: string
  }
}

export interface DiscordUnpinMessageParams extends DiscordAuthParams {
  channelId: string
  messageId: string
}

export interface DiscordUnpinMessageResponse extends BaseDiscordResponse {
  output: {
    message: string
  }
}

// Thread operations
export interface DiscordCreateThreadParams extends DiscordAuthParams {
  channelId: string
  name: string
  messageId?: string
  autoArchiveDuration?: number
}

export interface DiscordCreateThreadResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: any
  }
}

export interface DiscordJoinThreadParams extends DiscordAuthParams {
  threadId: string
}

export interface DiscordJoinThreadResponse extends BaseDiscordResponse {
  output: {
    message: string
  }
}

export interface DiscordLeaveThreadParams extends DiscordAuthParams {
  threadId: string
}

export interface DiscordLeaveThreadResponse extends BaseDiscordResponse {
  output: {
    message: string
  }
}

export interface DiscordArchiveThreadParams extends DiscordAuthParams {
  threadId: string
  archived: boolean
}

export interface DiscordArchiveThreadResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: any
  }
}

// Channel operations
export interface DiscordCreateChannelParams extends DiscordAuthParams {
  name: string
  type?: number
  topic?: string
  parentId?: string
}

export interface DiscordCreateChannelResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: any
  }
}

export interface DiscordUpdateChannelParams extends DiscordAuthParams {
  channelId: string
  name?: string
  topic?: string
}

export interface DiscordUpdateChannelResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: any
  }
}

export interface DiscordDeleteChannelParams extends DiscordAuthParams {
  channelId: string
}

export interface DiscordDeleteChannelResponse extends BaseDiscordResponse {
  output: {
    message: string
  }
}

export interface DiscordGetChannelParams extends DiscordAuthParams {
  channelId: string
}

export interface DiscordGetChannelResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: any
  }
}

// Role operations
export interface DiscordCreateRoleParams extends DiscordAuthParams {
  name: string
  color?: number
  hoist?: boolean
  mentionable?: boolean
}

export interface DiscordCreateRoleResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: any
  }
}

export interface DiscordUpdateRoleParams extends DiscordAuthParams {
  roleId: string
  name?: string
  color?: number
  hoist?: boolean
  mentionable?: boolean
}

export interface DiscordUpdateRoleResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: any
  }
}

export interface DiscordDeleteRoleParams extends DiscordAuthParams {
  roleId: string
}

export interface DiscordDeleteRoleResponse extends BaseDiscordResponse {
  output: {
    message: string
  }
}

export interface DiscordAssignRoleParams extends DiscordAuthParams {
  userId: string
  roleId: string
}

export interface DiscordAssignRoleResponse extends BaseDiscordResponse {
  output: {
    message: string
  }
}

export interface DiscordRemoveRoleParams extends DiscordAuthParams {
  userId: string
  roleId: string
}

export interface DiscordRemoveRoleResponse extends BaseDiscordResponse {
  output: {
    message: string
  }
}

// Member operations
export interface DiscordKickMemberParams extends DiscordAuthParams {
  userId: string
  reason?: string
}

export interface DiscordKickMemberResponse extends BaseDiscordResponse {
  output: {
    message: string
  }
}

export interface DiscordBanMemberParams extends DiscordAuthParams {
  userId: string
  reason?: string
  deleteMessageDays?: number
}

export interface DiscordBanMemberResponse extends BaseDiscordResponse {
  output: {
    message: string
  }
}

export interface DiscordUnbanMemberParams extends DiscordAuthParams {
  userId: string
  reason?: string
}

export interface DiscordUnbanMemberResponse extends BaseDiscordResponse {
  output: {
    message: string
  }
}

export interface DiscordGetMemberParams extends DiscordAuthParams {
  userId: string
}

export interface DiscordGetMemberResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: any
  }
}

export interface DiscordUpdateMemberParams extends DiscordAuthParams {
  userId: string
  nick?: string
  mute?: boolean
  deaf?: boolean
}

export interface DiscordUpdateMemberResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: any
  }
}

// Invite operations
export interface DiscordCreateInviteParams extends DiscordAuthParams {
  channelId: string
  maxAge?: number
  maxUses?: number
  temporary?: boolean
}

export interface DiscordCreateInviteResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: any
  }
}

export interface DiscordGetInviteParams extends DiscordAuthParams {
  inviteCode: string
}

export interface DiscordGetInviteResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: any
  }
}

export interface DiscordDeleteInviteParams extends DiscordAuthParams {
  inviteCode: string
}

export interface DiscordDeleteInviteResponse extends BaseDiscordResponse {
  output: {
    message: string
  }
}

// Webhook operations
export interface DiscordCreateWebhookParams extends DiscordAuthParams {
  channelId: string
  name: string
}

export interface DiscordCreateWebhookResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: any
  }
}

export interface DiscordExecuteWebhookParams extends DiscordAuthParams {
  webhookId: string
  webhookToken: string
  content: string
  username?: string
}

export interface DiscordExecuteWebhookResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: any
  }
}

export interface DiscordGetWebhookParams extends DiscordAuthParams {
  webhookId: string
}

export interface DiscordGetWebhookResponse extends BaseDiscordResponse {
  output: {
    message: string
    data?: any
  }
}

export interface DiscordDeleteWebhookParams extends DiscordAuthParams {
  webhookId: string
}

export interface DiscordDeleteWebhookResponse extends BaseDiscordResponse {
  output: {
    message: string
  }
}

export type DiscordResponse =
  | DiscordSendMessageResponse
  | DiscordGetMessagesResponse
  | DiscordGetServerResponse
  | DiscordGetUserResponse
  | DiscordEditMessageResponse
  | DiscordDeleteMessageResponse
  | DiscordAddReactionResponse
  | DiscordRemoveReactionResponse
  | DiscordPinMessageResponse
  | DiscordUnpinMessageResponse
  | DiscordCreateThreadResponse
  | DiscordJoinThreadResponse
  | DiscordLeaveThreadResponse
  | DiscordArchiveThreadResponse
  | DiscordCreateChannelResponse
  | DiscordUpdateChannelResponse
  | DiscordDeleteChannelResponse
  | DiscordGetChannelResponse
  | DiscordCreateRoleResponse
  | DiscordUpdateRoleResponse
  | DiscordDeleteRoleResponse
  | DiscordAssignRoleResponse
  | DiscordRemoveRoleResponse
  | DiscordKickMemberResponse
  | DiscordBanMemberResponse
  | DiscordUnbanMemberResponse
  | DiscordGetMemberResponse
  | DiscordUpdateMemberResponse
  | DiscordCreateInviteResponse
  | DiscordGetInviteResponse
  | DiscordDeleteInviteResponse
  | DiscordCreateWebhookResponse
  | DiscordExecuteWebhookResponse
  | DiscordGetWebhookResponse
  | DiscordDeleteWebhookResponse
