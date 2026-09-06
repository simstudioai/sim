import { internalExecution, listCommon } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_TALENT_PROFILES_OUTPUTS,
  type OracleFusionHcmListTalentProfilesParams,
  type OracleFusionHcmListTalentProfilesResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListTalentProfilesTool: InternalToolConfig<
  OracleFusionHcmListTalentProfilesParams,
  OracleFusionHcmListTalentProfilesResponse
> = {
  id: 'oracle_fusion_hcm_list_talent_profiles',
  name: 'List Talent Profiles in Oracle Fusion HCM',
  description:
    'Read one page of talent profiles from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    personId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Person ID, as a positive decimal string',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search text (maximum 200 characters)',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_TALENT_PROFILES_OUTPUTS,
}
