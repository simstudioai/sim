import { internalExecution, searchable } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_JOBS_OUTPUTS,
  type OracleFusionHcmListJobsParams,
  type OracleFusionHcmListJobsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListJobsTool: InternalToolConfig<
  OracleFusionHcmListJobsParams,
  OracleFusionHcmListJobsResponse
> = {
  id: 'oracle_fusion_hcm_list_jobs',
  name: 'List Oracle Fusion HCM Jobs',
  description: 'List or search jobs.',
  ...internalExecution,
  params: searchable,
  outputs: ORACLE_FUSION_HCM_LIST_JOBS_OUTPUTS,
}
