import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  interopStatusSchema,
  type PlanningOperationContext,
  parsePlanningResponse,
  requireInteropSuccess,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningDeleteFileParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/delete_files_v2.html */
export async function executeOracleEpmPlanningDeleteFile(
  input: OracleEpmPlanningDeleteFileParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const parsed = parsePlanningResponse(
    interopStatusSchema,
    await context.client.request(planningEndpoints.deleteFile, {
      json: { fileName: input.fileName },
      signal: context.signal,
    })
  )
  requireInteropSuccess(parsed)
  return { success: true, output: { deleted: true } }
}
