import { internalExecution, searchable } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_LEGAL_EMPLOYERS_OUTPUTS,
  type OracleFusionHcmListLegalEmployersParams,
  type OracleFusionHcmListLegalEmployersResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListLegalEmployersTool: InternalToolConfig<
  OracleFusionHcmListLegalEmployersParams,
  OracleFusionHcmListLegalEmployersResponse
> = {
  id: 'oracle_fusion_hcm_list_legal_employers',
  name: 'List Oracle Fusion HCM Legal Employers',
  description: 'List or search legal employers.',
  ...internalExecution,
  params: searchable,
  outputs: ORACLE_FUSION_HCM_LIST_LEGAL_EMPLOYERS_OUTPUTS,
}
