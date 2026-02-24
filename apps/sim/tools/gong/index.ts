import { aggregateActivityTool } from '@/tools/gong/aggregate_activity'
import { answeredScorecardsTool } from '@/tools/gong/answered_scorecards'
import { getCallTool } from '@/tools/gong/get_call'
import { getCallTranscriptTool } from '@/tools/gong/get_call_transcript'
import { getCoachingTool } from '@/tools/gong/get_coaching'
import { getExtensiveCallsTool } from '@/tools/gong/get_extensive_calls'
import { getFolderContentTool } from '@/tools/gong/get_folder_content'
import { getUserTool } from '@/tools/gong/get_user'
import { interactionStatsTool } from '@/tools/gong/interaction_stats'
import { listCallsTool } from '@/tools/gong/list_calls'
import { listFlowsTool } from '@/tools/gong/list_flows'
import { listLibraryFoldersTool } from '@/tools/gong/list_library_folders'
import { listScorecardsTool } from '@/tools/gong/list_scorecards'
import { listTrackersTool } from '@/tools/gong/list_trackers'
import { listUsersTool } from '@/tools/gong/list_users'
import { listWorkspacesTool } from '@/tools/gong/list_workspaces'
import { lookupEmailTool } from '@/tools/gong/lookup_email'
import { lookupPhoneTool } from '@/tools/gong/lookup_phone'

export const gongListCallsTool = listCallsTool
export const gongGetCallTool = getCallTool
export const gongGetCallTranscriptTool = getCallTranscriptTool
export const gongGetExtensiveCallsTool = getExtensiveCallsTool
export const gongListUsersTool = listUsersTool
export const gongGetUserTool = getUserTool
export const gongAggregateActivityTool = aggregateActivityTool
export const gongInteractionStatsTool = interactionStatsTool
export const gongAnsweredScorecardsTool = answeredScorecardsTool
export const gongListLibraryFoldersTool = listLibraryFoldersTool
export const gongGetFolderContentTool = getFolderContentTool
export const gongListScorecardsTool = listScorecardsTool
export const gongListTrackersTool = listTrackersTool
export const gongListWorkspacesTool = listWorkspacesTool
export const gongListFlowsTool = listFlowsTool
export const gongGetCoachingTool = getCoachingTool
export const gongLookupEmailTool = lookupEmailTool
export const gongLookupPhoneTool = lookupPhoneTool
