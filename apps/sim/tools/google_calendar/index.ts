import { createTool, createV2Tool } from '@/tools/google_calendar/create'
import { getTool, getV2Tool } from '@/tools/google_calendar/get'
import { inviteTool, inviteV2Tool } from '@/tools/google_calendar/invite'
import { listTool, listV2Tool } from '@/tools/google_calendar/list'
import { quickAddTool, quickAddV2Tool } from '@/tools/google_calendar/quick_add'

export const googleCalendarCreateTool = createTool
export const googleCalendarGetTool = getTool
export const googleCalendarInviteTool = inviteTool
export const googleCalendarListTool = listTool
export const googleCalendarQuickAddTool = quickAddTool

export const googleCalendarCreateV2Tool = createV2Tool
export const googleCalendarGetV2Tool = getV2Tool
export const googleCalendarInviteV2Tool = inviteV2Tool
export const googleCalendarListV2Tool = listV2Tool
export const googleCalendarQuickAddV2Tool = quickAddV2Tool
