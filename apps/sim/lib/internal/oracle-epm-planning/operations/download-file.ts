import { downloadPlanningFile } from '@/lib/internal/oracle-epm-planning/files.server'
import type { PlanningOperationContext } from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningDownloadFileParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/download_application_snapshot_v2.html */
export async function executeOracleEpmPlanningDownloadFile(
  input: OracleEpmPlanningDownloadFileParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  return { success: true, output: { file: await downloadPlanningFile(input, context) } }
}
