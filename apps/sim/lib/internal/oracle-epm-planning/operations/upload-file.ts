import { uploadPlanningFile } from '@/lib/internal/oracle-epm-planning/files.server'
import { type PlanningOperationContext } from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningResponse,
  OracleEpmPlanningUploadFileParams,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/upload_application_snapshot.html */
export async function executeOracleEpmPlanningUploadFile(
  input: OracleEpmPlanningUploadFileParams,
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  return { success: true, output: { upload: await uploadPlanningFile(input, context) } }
}
