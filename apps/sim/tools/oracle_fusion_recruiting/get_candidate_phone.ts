import { credentials, internalExecution } from '@/tools/oracle_fusion_recruiting/common'
import {
  GET_CANDIDATE_PHONE_OUTPUTS,
  type OracleFusionRecruitingGetCandidatePhoneParams,
  type OracleFusionRecruitingGetCandidatePhoneResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingGetCandidatePhoneTool: InternalToolConfig<
  OracleFusionRecruitingGetCandidatePhoneParams,
  OracleFusionRecruitingGetCandidatePhoneResponse
> = {
  id: 'oracle_fusion_recruiting_get_candidate_phone',
  name: 'Get Candidate Phone',
  description: 'Get candidate phone.',
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
  },
  outputs: GET_CANDIDATE_PHONE_OUTPUTS,
}
