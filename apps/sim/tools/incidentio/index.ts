import { actionsListTool } from '@/tools/incidentio/actions_list'
import { actionsShowTool } from '@/tools/incidentio/actions_show'
import { customFieldsCreateTool } from '@/tools/incidentio/custom_fields_create'
import { customFieldsDeleteTool } from '@/tools/incidentio/custom_fields_delete'
import { customFieldsListTool } from '@/tools/incidentio/custom_fields_list'
import { customFieldsShowTool } from '@/tools/incidentio/custom_fields_show'
import { customFieldsUpdateTool } from '@/tools/incidentio/custom_fields_update'
import { escalationsCreateTool } from '@/tools/incidentio/escalations_create'
import { escalationsListTool } from '@/tools/incidentio/escalations_list'
import { escalationsShowTool } from '@/tools/incidentio/escalations_show'
import { followUpsListTool } from '@/tools/incidentio/follow_ups_list'
import { followUpsShowTool } from '@/tools/incidentio/follow_ups_show'
import { incidentStatusesListTool } from '@/tools/incidentio/incident_statuses_list'
import { incidentTypesListTool } from '@/tools/incidentio/incident_types_list'
import { incidentsCreateTool } from '@/tools/incidentio/incidents_create'
import { incidentsListTool } from '@/tools/incidentio/incidents_list'
import { incidentsShowTool } from '@/tools/incidentio/incidents_show'
import { incidentsUpdateTool } from '@/tools/incidentio/incidents_update'
import { schedulesCreateTool } from '@/tools/incidentio/schedules_create'
import { schedulesDeleteTool } from '@/tools/incidentio/schedules_delete'
import { schedulesListTool } from '@/tools/incidentio/schedules_list'
import { schedulesShowTool } from '@/tools/incidentio/schedules_show'
import { schedulesUpdateTool } from '@/tools/incidentio/schedules_update'
import { severitiesListTool } from '@/tools/incidentio/severities_list'
import { usersListTool } from '@/tools/incidentio/users_list'
import { usersShowTool } from '@/tools/incidentio/users_show'
import { workflowsCreateTool } from '@/tools/incidentio/workflows_create'
import { workflowsDeleteTool } from '@/tools/incidentio/workflows_delete'
import { workflowsListTool } from '@/tools/incidentio/workflows_list'
import { workflowsShowTool } from '@/tools/incidentio/workflows_show'
import { workflowsUpdateTool } from '@/tools/incidentio/workflows_update'

export const incidentioIncidentsListTool = incidentsListTool
export const incidentioIncidentsCreateTool = incidentsCreateTool
export const incidentioIncidentsShowTool = incidentsShowTool
export const incidentioIncidentsUpdateTool = incidentsUpdateTool
export const incidentioActionsListTool = actionsListTool
export const incidentioActionsShowTool = actionsShowTool
export const incidentioFollowUpsListTool = followUpsListTool
export const incidentioFollowUpsShowTool = followUpsShowTool
export const incidentioWorkflowsListTool = workflowsListTool
export const incidentioWorkflowsCreateTool = workflowsCreateTool
export const incidentioWorkflowsShowTool = workflowsShowTool
export const incidentioWorkflowsUpdateTool = workflowsUpdateTool
export const incidentioWorkflowsDeleteTool = workflowsDeleteTool
export const incidentioCustomFieldsListTool = customFieldsListTool
export const incidentioCustomFieldsCreateTool = customFieldsCreateTool
export const incidentioCustomFieldsShowTool = customFieldsShowTool
export const incidentioCustomFieldsUpdateTool = customFieldsUpdateTool
export const incidentioCustomFieldsDeleteTool = customFieldsDeleteTool
export const incidentioUsersListTool = usersListTool
export const incidentioUsersShowTool = usersShowTool
export const incidentioSeveritiesListTool = severitiesListTool
export const incidentioIncidentStatusesListTool = incidentStatusesListTool
export const incidentioIncidentTypesListTool = incidentTypesListTool
export const incidentioEscalationsListTool = escalationsListTool
export const incidentioEscalationsCreateTool = escalationsCreateTool
export const incidentioEscalationsShowTool = escalationsShowTool
export const incidentioSchedulesListTool = schedulesListTool
export const incidentioSchedulesCreateTool = schedulesCreateTool
export const incidentioSchedulesShowTool = schedulesShowTool
export const incidentioSchedulesUpdateTool = schedulesUpdateTool
export const incidentioSchedulesDeleteTool = schedulesDeleteTool
