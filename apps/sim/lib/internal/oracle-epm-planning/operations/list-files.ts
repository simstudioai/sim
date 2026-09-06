import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  filesSchema,
  type PlanningOperationContext,
  parsePlanningResponse,
  requireInteropSuccess,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningListFilesParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/list_files_v2.html */
export async function executeOracleEpmPlanningListFiles(
  _input: OracleEpmPlanningListFilesParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const parsed = parsePlanningResponse(
    filesSchema,
    await context.client.request(planningEndpoints.files, { signal: context.signal })
  )
  requireInteropSuccess(parsed)
  return { success: true, output: { files: parsed.items } }
}
