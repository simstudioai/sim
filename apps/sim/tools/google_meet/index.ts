import { createSpaceTool } from '@/tools/google_meet/create_space'
import { endConferenceTool } from '@/tools/google_meet/end_conference'
import { getConferenceRecordTool } from '@/tools/google_meet/get_conference_record'
import { getSpaceTool } from '@/tools/google_meet/get_space'
import { listConferenceRecordsTool } from '@/tools/google_meet/list_conference_records'
import { listParticipantsTool } from '@/tools/google_meet/list_participants'

export const googleMeetCreateSpaceTool = createSpaceTool
export const googleMeetGetSpaceTool = getSpaceTool
export const googleMeetEndConferenceTool = endConferenceTool
export const googleMeetListConferenceRecordsTool = listConferenceRecordsTool
export const googleMeetGetConferenceRecordTool = getConferenceRecordTool
export const googleMeetListParticipantsTool = listParticipantsTool
