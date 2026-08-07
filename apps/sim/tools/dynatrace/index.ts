import { addProblemCommentTool } from '@/tools/dynatrace/add_problem_comment'
import { closeProblemTool } from '@/tools/dynatrace/close_problem'
import { getAuditLogsTool } from '@/tools/dynatrace/get_audit_logs'
import { getEntityTool } from '@/tools/dynatrace/get_entity'
import { getEventTool } from '@/tools/dynatrace/get_event'
import { getMetricTool } from '@/tools/dynatrace/get_metric'
import { getProblemTool } from '@/tools/dynatrace/get_problem'
import { getSecurityProblemTool } from '@/tools/dynatrace/get_security_problem'
import { getSloTool } from '@/tools/dynatrace/get_slo'
import { ingestEventTool } from '@/tools/dynatrace/ingest_event'
import { ingestLogsTool } from '@/tools/dynatrace/ingest_logs'
import { ingestMetricsTool } from '@/tools/dynatrace/ingest_metrics'
import { listEntitiesTool } from '@/tools/dynatrace/list_entities'
import { listEntityTypesTool } from '@/tools/dynatrace/list_entity_types'
import { listEventsTool } from '@/tools/dynatrace/list_events'
import { listMetricsTool } from '@/tools/dynatrace/list_metrics'
import { listProblemCommentsTool } from '@/tools/dynatrace/list_problem_comments'
import { listProblemsTool } from '@/tools/dynatrace/list_problems'
import { listSecurityProblemsTool } from '@/tools/dynatrace/list_security_problems'
import { listSlosTool } from '@/tools/dynatrace/list_slos'
import { queryMetricsTool } from '@/tools/dynatrace/query_metrics'
import { searchLogsTool } from '@/tools/dynatrace/search_logs'

export const dynatraceAddProblemCommentTool = addProblemCommentTool
export const dynatraceCloseProblemTool = closeProblemTool
export const dynatraceGetAuditLogsTool = getAuditLogsTool
export const dynatraceGetEntityTool = getEntityTool
export const dynatraceGetEventTool = getEventTool
export const dynatraceGetMetricTool = getMetricTool
export const dynatraceGetProblemTool = getProblemTool
export const dynatraceGetSecurityProblemTool = getSecurityProblemTool
export const dynatraceGetSloTool = getSloTool
export const dynatraceIngestEventTool = ingestEventTool
export const dynatraceIngestLogsTool = ingestLogsTool
export const dynatraceIngestMetricsTool = ingestMetricsTool
export const dynatraceListEntitiesTool = listEntitiesTool
export const dynatraceListEntityTypesTool = listEntityTypesTool
export const dynatraceListEventsTool = listEventsTool
export const dynatraceListMetricsTool = listMetricsTool
export const dynatraceListProblemCommentsTool = listProblemCommentsTool
export const dynatraceListProblemsTool = listProblemsTool
export const dynatraceListSecurityProblemsTool = listSecurityProblemsTool
export const dynatraceListSlosTool = listSlosTool
export const dynatraceQueryMetricsTool = queryMetricsTool
export const dynatraceSearchLogsTool = searchLogsTool
