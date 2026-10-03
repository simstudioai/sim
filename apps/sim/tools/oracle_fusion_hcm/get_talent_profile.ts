import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_GET_TALENT_PROFILE_OUTPUTS,
  type OracleFusionHcmGetTalentProfileParams,
  type OracleFusionHcmGetTalentProfileResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmGetTalentProfileTool: InternalToolConfig<
  OracleFusionHcmGetTalentProfileParams,
  OracleFusionHcmGetTalentProfileResponse
> = {
  id: 'oracle_fusion_hcm_get_talent_profile',
  name: 'Get Talent Profile in Oracle Fusion HCM',
  description:
    'Read an Oracle Fusion HCM talent profile by its documented ID, subject to tenant data access.',
  ...internalExecution,
  params: {
    ...common,
    profileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Profile ID, as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_GET_TALENT_PROFILE_OUTPUTS,
}
