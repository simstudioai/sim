import { internalExecution, searchable } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_JOB_FAMILIES_OUTPUTS,
  type OracleFusionHcmListJobFamiliesParams,
  type OracleFusionHcmListJobFamiliesResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListJobFamiliesTool: InternalToolConfig<
  OracleFusionHcmListJobFamiliesParams,
  OracleFusionHcmListJobFamiliesResponse
> = {
  id: 'oracle_fusion_hcm_list_job_families',
  name: 'List Oracle Fusion HCM Job Families',
  description: 'List or search job families.',
  ...internalExecution,
  params: searchable,
  outputs: ORACLE_FUSION_HCM_LIST_JOB_FAMILIES_OUTPUTS,
}
