import { common, internalExecution, page, search } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_PERSON_TYPES_OUTPUTS,
  type OracleFusionHcmListPersonTypesParams,
  type OracleFusionHcmListPersonTypesResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListPersonTypesTool: InternalToolConfig<
  OracleFusionHcmListPersonTypesParams,
  OracleFusionHcmListPersonTypesResponse
> = {
  id: 'oracle_fusion_hcm_list_person_types',
  name: 'List Oracle Fusion HCM Person Types',
  description: 'List or search person types.',
  ...internalExecution,
  params: { ...common, ...search, ...page },
  outputs: ORACLE_FUSION_HCM_LIST_PERSON_TYPES_OUTPUTS,
}
