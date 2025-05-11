import { discordGetMessagesTool } from './get_messages'
import { discordGetServerTool } from './get_server'
import { discordGetUserTool } from './get_user'
import { discordSendMessageTool } from './send_message'

export const discordTools = {
  discord_send_message: discordSendMessageTool,
  discord_get_messages: discordGetMessagesTool,
  discord_get_server: discordGetServerTool,
  discord_get_user: discordGetUserTool,
}

export { discordSendMessageTool, discordGetMessagesTool, discordGetServerTool, discordGetUserTool }
