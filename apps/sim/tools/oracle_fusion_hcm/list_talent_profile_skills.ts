import { listCommon, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_TALENT_PROFILE_SKILLS_OUTPUTS,
  type OracleFusionHcmListTalentProfileSkillsParams,
  type OracleFusionHcmListTalentProfileSkillsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListTalentProfileSkillsTool: InternalToolConfig<
  OracleFusionHcmListTalentProfileSkillsParams,
  OracleFusionHcmListTalentProfileSkillsResponse
> = {
  id: 'oracle_fusion_hcm_list_talent_profile_skills',
  name: 'List Talent Profile Skills in Oracle Fusion HCM',
  description: 'Read one page of talent profile skills from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    profileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Profile ID, as a positive decimal string',
    },
    profileSectionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Profile section ID, as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_TALENT_PROFILE_SKILLS_OUTPUTS,
}
