import { eventSegmentationTool } from '@/tools/amplitude/event_segmentation'
import { getActiveUsersTool } from '@/tools/amplitude/get_active_users'
import { getRevenueTool } from '@/tools/amplitude/get_revenue'
import { groupIdentifyTool } from '@/tools/amplitude/group_identify'
import { identifyUserTool } from '@/tools/amplitude/identify_user'
import { listEventsTool } from '@/tools/amplitude/list_events'
import { realtimeActiveUsersTool } from '@/tools/amplitude/realtime_active_users'
import { sendEventTool } from '@/tools/amplitude/send_event'
import { userActivityTool } from '@/tools/amplitude/user_activity'
import { userProfileTool } from '@/tools/amplitude/user_profile'
import { userSearchTool } from '@/tools/amplitude/user_search'

export const amplitudeSendEventTool = sendEventTool
export const amplitudeIdentifyUserTool = identifyUserTool
export const amplitudeGroupIdentifyTool = groupIdentifyTool
export const amplitudeUserSearchTool = userSearchTool
export const amplitudeUserActivityTool = userActivityTool
export const amplitudeUserProfileTool = userProfileTool
export const amplitudeEventSegmentationTool = eventSegmentationTool
export const amplitudeGetActiveUsersTool = getActiveUsersTool
export const amplitudeRealtimeActiveUsersTool = realtimeActiveUsersTool
export const amplitudeListEventsTool = listEventsTool
export const amplitudeGetRevenueTool = getRevenueTool
