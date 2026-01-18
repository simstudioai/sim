import { createTool, createV2Tool } from '@/tools/google_calendar/create'
import { deleteTool, deleteV2Tool } from '@/tools/google_calendar/delete'
import { getTool, getV2Tool } from '@/tools/google_calendar/get'
import { instancesTool, instancesV2Tool } from '@/tools/google_calendar/instances'
import { inviteTool, inviteV2Tool } from '@/tools/google_calendar/invite'
import { listTool, listV2Tool } from '@/tools/google_calendar/list'
import { listCalendarsTool, listCalendarsV2Tool } from '@/tools/google_calendar/list_calendars'
import { moveTool, moveV2Tool } from '@/tools/google_calendar/move'
import { quickAddTool, quickAddV2Tool } from '@/tools/google_calendar/quick_add'
import { updateTool, updateV2Tool } from '@/tools/google_calendar/update'

export const googleCalendarCreateTool = createTool
export const googleCalendarDeleteTool = deleteTool
export const googleCalendarGetTool = getTool
export const googleCalendarInstancesTool = instancesTool
export const googleCalendarInviteTool = inviteTool
export const googleCalendarListTool = listTool
export const googleCalendarListCalendarsTool = listCalendarsTool
export const googleCalendarMoveTool = moveTool
export const googleCalendarQuickAddTool = quickAddTool
export const googleCalendarUpdateTool = updateTool

export const googleCalendarCreateV2Tool = createV2Tool
export const googleCalendarDeleteV2Tool = deleteV2Tool
export const googleCalendarGetV2Tool = getV2Tool
export const googleCalendarInstancesV2Tool = instancesV2Tool
export const googleCalendarInviteV2Tool = inviteV2Tool
export const googleCalendarListV2Tool = listV2Tool
export const googleCalendarListCalendarsV2Tool = listCalendarsV2Tool
export const googleCalendarMoveV2Tool = moveV2Tool
export const googleCalendarQuickAddV2Tool = quickAddV2Tool
export const googleCalendarUpdateV2Tool = updateV2Tool
