import { credentials, internalExecution } from '@/tools/oracle_fusion_recruiting/common'
import {
  CREATE_CANDIDATE_PHONE_OUTPUTS,
  type OracleFusionRecruitingCreateCandidatePhoneParams,
  type OracleFusionRecruitingCreateCandidatePhoneResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingCreateCandidatePhoneTool: InternalToolConfig<
  OracleFusionRecruitingCreateCandidatePhoneParams,
  OracleFusionRecruitingCreateCandidatePhoneResponse
> = {
  id: 'oracle_fusion_recruiting_create_candidate_phone',
  name: 'Create Candidate Phone',
  description: 'Create candidate phone.',
  ...internalExecution,
  params: {
    ...credentials,
    candidateNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Candidate number; use the identifier returned by the matching list tool',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Documented Oracle fields: PhoneNumber, CountryCodeNumber, AreaCode, LegislationCode. Int64 IDs must be decimal strings.',
    },
  },
  outputs: CREATE_CANDIDATE_PHONE_OUTPUTS,
}
