import { addProblemCommentTool } from '@/tools/dynatrace/add_problem_comment'
import { addTagsTool } from '@/tools/dynatrace/add_tags'
import { closeProblemTool } from '@/tools/dynatrace/close_problem'
import { createSettingsObjectTool } from '@/tools/dynatrace/create_settings_object'
import { createSloTool } from '@/tools/dynatrace/create_slo'
import { deleteProblemCommentTool } from '@/tools/dynatrace/delete_problem_comment'
import { deleteSettingsObjectTool } from '@/tools/dynatrace/delete_settings_object'
import { deleteSloTool } from '@/tools/dynatrace/delete_slo'
import { deleteTagTool } from '@/tools/dynatrace/delete_tag'
import { executeSyntheticMonitorsTool } from '@/tools/dynatrace/execute_synthetic_monitors'
import { getAttackTool } from '@/tools/dynatrace/get_attack'
import { getAuditLogsTool } from '@/tools/dynatrace/get_audit_logs'
import { getEntityTool } from '@/tools/dynatrace/get_entity'
import { getEventTool } from '@/tools/dynatrace/get_event'
import { getMetricTool } from '@/tools/dynatrace/get_metric'
import { getProblemTool } from '@/tools/dynatrace/get_problem'
import { getProblemCommentTool } from '@/tools/dynatrace/get_problem_comment'
import { getSecurityProblemTool } from '@/tools/dynatrace/get_security_problem'
import { getSettingsObjectTool } from '@/tools/dynatrace/get_settings_object'
import { getSloTool } from '@/tools/dynatrace/get_slo'
import { getSyntheticBatchTool } from '@/tools/dynatrace/get_synthetic_batch'
import { ingestEventTool } from '@/tools/dynatrace/ingest_event'
import { ingestLogsTool } from '@/tools/dynatrace/ingest_logs'
import { ingestMetricsTool } from '@/tools/dynatrace/ingest_metrics'
import { listAttacksTool } from '@/tools/dynatrace/list_attacks'
import { listEntitiesTool } from '@/tools/dynatrace/list_entities'
import { listEntityTypesTool } from '@/tools/dynatrace/list_entity_types'
import { listEventsTool } from '@/tools/dynatrace/list_events'
import { listMetricsTool } from '@/tools/dynatrace/list_metrics'
import { listProblemCommentsTool } from '@/tools/dynatrace/list_problem_comments'
import { listProblemsTool } from '@/tools/dynatrace/list_problems'
import { listRemediationItemsTool } from '@/tools/dynatrace/list_remediation_items'
import { listSecurityProblemsTool } from '@/tools/dynatrace/list_security_problems'
import { listSettingsObjectsTool } from '@/tools/dynatrace/list_settings_objects'
import { listSettingsSchemasTool } from '@/tools/dynatrace/list_settings_schemas'
import { listSlosTool } from '@/tools/dynatrace/list_slos'
import { listSyntheticMonitorsTool } from '@/tools/dynatrace/list_synthetic_monitors'
import { listTagsTool } from '@/tools/dynatrace/list_tags'
import { muteSecurityProblemTool } from '@/tools/dynatrace/mute_security_problem'
import { muteSecurityProblemsTool } from '@/tools/dynatrace/mute_security_problems'
import { queryMetricsTool } from '@/tools/dynatrace/query_metrics'
import { searchLogsTool } from '@/tools/dynatrace/search_logs'
import { unmuteSecurityProblemTool } from '@/tools/dynatrace/unmute_security_problem'
import { unmuteSecurityProblemsTool } from '@/tools/dynatrace/unmute_security_problems'
import { updateProblemCommentTool } from '@/tools/dynatrace/update_problem_comment'
import { updateSettingsObjectTool } from '@/tools/dynatrace/update_settings_object'
import { updateSloTool } from '@/tools/dynatrace/update_slo'

export const dynatraceAddProblemCommentTool = addProblemCommentTool
export const dynatraceAddTagsTool = addTagsTool
export const dynatraceCloseProblemTool = closeProblemTool
export const dynatraceCreateSettingsObjectTool = createSettingsObjectTool
export const dynatraceCreateSloTool = createSloTool
export const dynatraceDeleteProblemCommentTool = deleteProblemCommentTool
export const dynatraceDeleteSettingsObjectTool = deleteSettingsObjectTool
export const dynatraceDeleteSloTool = deleteSloTool
export const dynatraceDeleteTagTool = deleteTagTool
export const dynatraceExecuteSyntheticMonitorsTool = executeSyntheticMonitorsTool
export const dynatraceGetAttackTool = getAttackTool
export const dynatraceGetAuditLogsTool = getAuditLogsTool
export const dynatraceGetEntityTool = getEntityTool
export const dynatraceGetEventTool = getEventTool
export const dynatraceGetMetricTool = getMetricTool
export const dynatraceGetProblemTool = getProblemTool
export const dynatraceGetProblemCommentTool = getProblemCommentTool
export const dynatraceGetSecurityProblemTool = getSecurityProblemTool
export const dynatraceGetSettingsObjectTool = getSettingsObjectTool
export const dynatraceGetSloTool = getSloTool
export const dynatraceGetSyntheticBatchTool = getSyntheticBatchTool
export const dynatraceIngestEventTool = ingestEventTool
export const dynatraceIngestLogsTool = ingestLogsTool
export const dynatraceIngestMetricsTool = ingestMetricsTool
export const dynatraceListAttacksTool = listAttacksTool
export const dynatraceListEntitiesTool = listEntitiesTool
export const dynatraceListEntityTypesTool = listEntityTypesTool
export const dynatraceListEventsTool = listEventsTool
export const dynatraceListMetricsTool = listMetricsTool
export const dynatraceListProblemCommentsTool = listProblemCommentsTool
export const dynatraceListProblemsTool = listProblemsTool
export const dynatraceListRemediationItemsTool = listRemediationItemsTool
export const dynatraceListSecurityProblemsTool = listSecurityProblemsTool
export const dynatraceListSettingsObjectsTool = listSettingsObjectsTool
export const dynatraceListSettingsSchemasTool = listSettingsSchemasTool
export const dynatraceListSlosTool = listSlosTool
export const dynatraceListSyntheticMonitorsTool = listSyntheticMonitorsTool
export const dynatraceListTagsTool = listTagsTool
export const dynatraceMuteSecurityProblemTool = muteSecurityProblemTool
export const dynatraceMuteSecurityProblemsTool = muteSecurityProblemsTool
export const dynatraceQueryMetricsTool = queryMetricsTool
export const dynatraceSearchLogsTool = searchLogsTool
export const dynatraceUnmuteSecurityProblemTool = unmuteSecurityProblemTool
export const dynatraceUnmuteSecurityProblemsTool = unmuteSecurityProblemsTool
export const dynatraceUpdateProblemCommentTool = updateProblemCommentTool
export const dynatraceUpdateSettingsObjectTool = updateSettingsObjectTool
export const dynatraceUpdateSloTool = updateSloTool
