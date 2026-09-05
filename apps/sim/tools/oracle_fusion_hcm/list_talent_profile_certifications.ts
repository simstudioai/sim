import { listCommon, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_TALENT_PROFILE_CERTIFICATIONS_OUTPUTS,
  type OracleFusionHcmListTalentProfileCertificationsParams,
  type OracleFusionHcmListTalentProfileCertificationsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListTalentProfileCertificationsTool: InternalToolConfig<
  OracleFusionHcmListTalentProfileCertificationsParams,
  OracleFusionHcmListTalentProfileCertificationsResponse
> = {
  id: 'oracle_fusion_hcm_list_talent_profile_certifications',
  name: 'List Talent Profile Certifications in Oracle Fusion HCM',
  description: 'Read one page of talent profile certifications from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
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
  outputs: ORACLE_FUSION_HCM_LIST_TALENT_PROFILE_CERTIFICATIONS_OUTPUTS,
}
