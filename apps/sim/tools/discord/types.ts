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

export type DiscordResponse =
  | DiscordSendMessageResponse
  | DiscordGetMessagesResponse
  | DiscordGetServerResponse
  | DiscordGetUserResponse
