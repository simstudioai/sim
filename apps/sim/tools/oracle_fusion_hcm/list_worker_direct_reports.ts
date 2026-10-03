import {
  assignmentId,
  internalExecution,
  listCommon,
  personId,
} from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_DIRECT_REPORTS_OUTPUTS,
  type OracleFusionHcmListWorkerDirectReportsParams,
  type OracleFusionHcmListWorkerDirectReportsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListWorkerDirectReportsTool: InternalToolConfig<
  OracleFusionHcmListWorkerDirectReportsParams,
  OracleFusionHcmListWorkerDirectReportsResponse
> = {
  id: 'oracle_fusion_hcm_list_worker_direct_reports',
  name: 'List Oracle Fusion HCM Direct Reports',
  description: 'List direct reports for a worker assignment.',
  ...internalExecution,
  params: { ...listCommon, ...personId, ...assignmentId },
  outputs: ORACLE_FUSION_HCM_LIST_DIRECT_REPORTS_OUTPUTS,
}
