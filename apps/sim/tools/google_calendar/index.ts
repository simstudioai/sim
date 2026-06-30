import { createTool, createV2Tool } from '@/tools/google_calendar/create'
import { createCalendarTool, createCalendarV2Tool } from '@/tools/google_calendar/create_calendar'
import { deleteTool, deleteV2Tool } from '@/tools/google_calendar/delete'
import { freebusyTool, freebusyV2Tool } from '@/tools/google_calendar/freebusy'
import { getTool, getV2Tool } from '@/tools/google_calendar/get'
import { instancesTool, instancesV2Tool } from '@/tools/google_calendar/instances'
import { inviteTool, inviteV2Tool } from '@/tools/google_calendar/invite'
import { listTool, listV2Tool } from '@/tools/google_calendar/list'
import { listAclTool, listAclV2Tool } from '@/tools/google_calendar/list_acl'
import { listCalendarsTool, listCalendarsV2Tool } from '@/tools/google_calendar/list_calendars'
import { moveTool, moveV2Tool } from '@/tools/google_calendar/move'
import { quickAddTool, quickAddV2Tool } from '@/tools/google_calendar/quick_add'
import { shareCalendarTool, shareCalendarV2Tool } from '@/tools/google_calendar/share_calendar'
import {
  unshareCalendarTool,
  unshareCalendarV2Tool,
} from '@/tools/google_calendar/unshare_calendar'
import { updateTool, updateV2Tool } from '@/tools/google_calendar/update'

export const googleCalendarCreateTool = createTool
export const googleCalendarCreateCalendarTool = createCalendarTool
export const googleCalendarDeleteTool = deleteTool
export const googleCalendarFreeBusyTool = freebusyTool
export const googleCalendarGetTool = getTool
export const googleCalendarInstancesTool = instancesTool
export const googleCalendarInviteTool = inviteTool
export const googleCalendarListTool = listTool
export const googleCalendarListAclTool = listAclTool
export const googleCalendarListCalendarsTool = listCalendarsTool
export const googleCalendarMoveTool = moveTool
export const googleCalendarQuickAddTool = quickAddTool
export const googleCalendarShareCalendarTool = shareCalendarTool
export const googleCalendarUnshareCalendarTool = unshareCalendarTool
export const googleCalendarUpdateTool = updateTool

export const googleCalendarCreateV2Tool = createV2Tool
export const googleCalendarCreateCalendarV2Tool = createCalendarV2Tool
export const googleCalendarDeleteV2Tool = deleteV2Tool
export const googleCalendarFreeBusyV2Tool = freebusyV2Tool
export const googleCalendarGetV2Tool = getV2Tool
export const googleCalendarInstancesV2Tool = instancesV2Tool
export const googleCalendarInviteV2Tool = inviteV2Tool
export const googleCalendarListV2Tool = listV2Tool
export const googleCalendarListAclV2Tool = listAclV2Tool
export const googleCalendarListCalendarsV2Tool = listCalendarsV2Tool
export const googleCalendarMoveV2Tool = moveV2Tool
export const googleCalendarQuickAddV2Tool = quickAddV2Tool
export const googleCalendarShareCalendarV2Tool = shareCalendarV2Tool
export const googleCalendarUnshareCalendarV2Tool = unshareCalendarV2Tool
export const googleCalendarUpdateV2Tool = updateV2Tool
