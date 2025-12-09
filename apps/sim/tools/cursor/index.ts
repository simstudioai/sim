import { addFollowupTool } from '@/tools/cursor/add_followup'
import { deleteAgentTool } from '@/tools/cursor/delete_agent'
import { getAgentTool } from '@/tools/cursor/get_agent'
import { getConversationTool } from '@/tools/cursor/get_conversation'
import { launchAgentTool } from '@/tools/cursor/launch_agent'
import { listAgentsTool } from '@/tools/cursor/list_agents'
import { stopAgentTool } from '@/tools/cursor/stop_agent'

export const cursorListAgentsTool = listAgentsTool
export const cursorGetAgentTool = getAgentTool
export const cursorGetConversationTool = getConversationTool
export const cursorLaunchAgentTool = launchAgentTool
export const cursorAddFollowupTool = addFollowupTool
export const cursorStopAgentTool = stopAgentTool
export const cursorDeleteAgentTool = deleteAgentTool
