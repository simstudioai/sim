import { addFollowupTool, addFollowupV2Tool } from '@/tools/cursor/add_followup'
import { deleteAgentTool, deleteAgentV2Tool } from '@/tools/cursor/delete_agent'
import { getAgentTool, getAgentV2Tool } from '@/tools/cursor/get_agent'
import { getConversationTool, getConversationV2Tool } from '@/tools/cursor/get_conversation'
import { launchAgentTool, launchAgentV2Tool } from '@/tools/cursor/launch_agent'
import { listAgentsTool, listAgentsV2Tool } from '@/tools/cursor/list_agents'
import { stopAgentTool, stopAgentV2Tool } from '@/tools/cursor/stop_agent'

export const cursorListAgentsTool = listAgentsTool
export const cursorGetAgentTool = getAgentTool
export const cursorGetConversationTool = getConversationTool
export const cursorLaunchAgentTool = launchAgentTool
export const cursorAddFollowupTool = addFollowupTool
export const cursorStopAgentTool = stopAgentTool
export const cursorDeleteAgentTool = deleteAgentTool

export const cursorListAgentsV2Tool = listAgentsV2Tool
export const cursorGetAgentV2Tool = getAgentV2Tool
export const cursorGetConversationV2Tool = getConversationV2Tool
export const cursorLaunchAgentV2Tool = launchAgentV2Tool
export const cursorAddFollowupV2Tool = addFollowupV2Tool
export const cursorStopAgentV2Tool = stopAgentV2Tool
export const cursorDeleteAgentV2Tool = deleteAgentV2Tool
