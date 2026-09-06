import { internalExecution, listCommon } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_TALENT_PROFILE_SECTIONS_OUTPUTS,
  type OracleFusionHcmListTalentProfileSectionsParams,
  type OracleFusionHcmListTalentProfileSectionsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListTalentProfileSectionsTool: InternalToolConfig<
  OracleFusionHcmListTalentProfileSectionsParams,
  OracleFusionHcmListTalentProfileSectionsResponse
> = {
  id: 'oracle_fusion_hcm_list_talent_profile_sections',
  name: 'List Talent Profile Sections in Oracle Fusion HCM',
  description:
    'Read one page of talent profile sections from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    profileId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Profile ID, as a positive decimal string',
    },
    sectionKind: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Secured profile section family: skill or certification',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_TALENT_PROFILE_SECTIONS_OUTPUTS,
}
