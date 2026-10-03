import { credentials, internalExecution } from '@/tools/oracle_fusion_recruiting/common'
import {
  type OracleFusionRecruitingUpdateCandidatePhoneParams,
  type OracleFusionRecruitingUpdateCandidatePhoneResponse,
  UPDATE_CANDIDATE_PHONE_OUTPUTS,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingUpdateCandidatePhoneTool: InternalToolConfig<
  OracleFusionRecruitingUpdateCandidatePhoneParams,
  OracleFusionRecruitingUpdateCandidatePhoneResponse
> = {
  id: 'oracle_fusion_recruiting_update_candidate_phone',
  name: 'Update Candidate Phone',
  description: 'Update candidate phone.',
  ...internalExecution,
  params: {
    ...credentials,
    candidateNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Candidate number; use the identifier returned by the matching list tool',
    },
    phoneId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Phone id; use the identifier returned by the matching list tool',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Documented Oracle fields: PhoneNumber, CountryCodeNumber, AreaCode, LegislationCode. Int64 IDs must be decimal strings.',
    },
  },
  outputs: UPDATE_CANDIDATE_PHONE_OUTPUTS,
}
