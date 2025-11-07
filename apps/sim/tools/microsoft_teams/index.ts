// Read operations

import { deleteChannelMessageTool } from '@/tools/microsoft_teams/delete_channel_message'
// Delete operations
import { deleteChatMessageTool } from '@/tools/microsoft_teams/delete_chat_message'
import { getMessageTool } from '@/tools/microsoft_teams/get_message'
import { listChannelMembersTool } from '@/tools/microsoft_teams/list_channel_members'
// Member operations
import { listTeamMembersTool } from '@/tools/microsoft_teams/list_team_members'
import { readChannelTool } from '@/tools/microsoft_teams/read_channel'
import { readChatTool } from '@/tools/microsoft_teams/read_chat'
// Reply operations
import { replyToMessageTool } from '@/tools/microsoft_teams/reply_to_message'
// Reaction operations
import { setReactionTool } from '@/tools/microsoft_teams/set_reaction'
import { unsetReactionTool } from '@/tools/microsoft_teams/unset_reaction'
import { updateChannelMessageTool } from '@/tools/microsoft_teams/update_channel_message'
// Update operations
import { updateChatMessageTool } from '@/tools/microsoft_teams/update_chat_message'
// Write operations
import { writeChannelTool } from '@/tools/microsoft_teams/write_channel'
import { writeChatTool } from '@/tools/microsoft_teams/write_chat'

// Read operations
export const microsoftTeamsReadChannelTool = readChannelTool
export const microsoftTeamsReadChatTool = readChatTool
export const microsoftTeamsGetMessageTool = getMessageTool

// Write operations
export const microsoftTeamsWriteChannelTool = writeChannelTool
export const microsoftTeamsWriteChatTool = writeChatTool

// Update operations
export const microsoftTeamsUpdateChatMessageTool = updateChatMessageTool
export const microsoftTeamsUpdateChannelMessageTool = updateChannelMessageTool

// Delete operations
export const microsoftTeamsDeleteChatMessageTool = deleteChatMessageTool
export const microsoftTeamsDeleteChannelMessageTool = deleteChannelMessageTool

// Reply operations
export const microsoftTeamsReplyToMessageTool = replyToMessageTool

// Reaction operations
export const microsoftTeamsSetReactionTool = setReactionTool
export const microsoftTeamsUnsetReactionTool = unsetReactionTool

// Member operations
export const microsoftTeamsListTeamMembersTool = listTeamMembersTool
export const microsoftTeamsListChannelMembersTool = listChannelMembersTool
