import { addNoteTool } from '@/tools/pagerduty/add_note'
import { createIncidentTool } from '@/tools/pagerduty/create_incident'
import { listIncidentsTool } from '@/tools/pagerduty/list_incidents'
import { listOncallsTool } from '@/tools/pagerduty/list_oncalls'
import { listServicesTool } from '@/tools/pagerduty/list_services'
import { updateIncidentTool } from '@/tools/pagerduty/update_incident'

export const pagerdutyListIncidentsTool = listIncidentsTool
export const pagerdutyCreateIncidentTool = createIncidentTool
export const pagerdutyUpdateIncidentTool = updateIncidentTool
export const pagerdutyAddNoteTool = addNoteTool
export const pagerdutyListServicesTool = listServicesTool
export const pagerdutyListOncallsTool = listOncallsTool
