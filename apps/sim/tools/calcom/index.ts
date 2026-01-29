import { cancelBookingTool } from '@/tools/calcom/cancel_booking'
import { confirmBookingTool } from '@/tools/calcom/confirm_booking'
import { createBookingTool } from '@/tools/calcom/create_booking'
import { createEventTypeTool } from '@/tools/calcom/create_event_type'
import { createScheduleTool } from '@/tools/calcom/create_schedule'
import { declineBookingTool } from '@/tools/calcom/decline_booking'
import { deleteEventTypeTool } from '@/tools/calcom/delete_event_type'
import { deleteScheduleTool } from '@/tools/calcom/delete_schedule'
import { getBookingTool } from '@/tools/calcom/get_booking'
import { getDefaultScheduleTool } from '@/tools/calcom/get_default_schedule'
import { getEventTypeTool } from '@/tools/calcom/get_event_type'
import { getScheduleTool } from '@/tools/calcom/get_schedule'
import { getSlotsTool } from '@/tools/calcom/get_slots'
import { listBookingsTool } from '@/tools/calcom/list_bookings'
import { listEventTypesTool } from '@/tools/calcom/list_event_types'
import { listSchedulesTool } from '@/tools/calcom/list_schedules'
import { rescheduleBookingTool } from '@/tools/calcom/reschedule_booking'
import { updateEventTypeTool } from '@/tools/calcom/update_event_type'
import { updateScheduleTool } from '@/tools/calcom/update_schedule'

export const calcomCancelBookingTool = cancelBookingTool
export const calcomConfirmBookingTool = confirmBookingTool
export const calcomCreateBookingTool = createBookingTool
export const calcomCreateEventTypeTool = createEventTypeTool
export const calcomCreateScheduleTool = createScheduleTool
export const calcomDeclineBookingTool = declineBookingTool
export const calcomDeleteEventTypeTool = deleteEventTypeTool
export const calcomDeleteScheduleTool = deleteScheduleTool
export const calcomGetBookingTool = getBookingTool
export const calcomGetDefaultScheduleTool = getDefaultScheduleTool
export const calcomGetEventTypeTool = getEventTypeTool
export const calcomGetScheduleTool = getScheduleTool
export const calcomGetSlotsTool = getSlotsTool
export const calcomListBookingsTool = listBookingsTool
export const calcomListEventTypesTool = listEventTypesTool
export const calcomListSchedulesTool = listSchedulesTool
export const calcomRescheduleBookingTool = rescheduleBookingTool
export const calcomUpdateEventTypeTool = updateEventTypeTool
export const calcomUpdateScheduleTool = updateScheduleTool
