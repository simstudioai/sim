import { credentials, internalExecution } from '@/tools/oracle_fusion_recruiting/common'
import {
  DELETE_CANDIDATE_PHONE_OUTPUTS,
  type OracleFusionRecruitingDeleteCandidatePhoneParams,
  type OracleFusionRecruitingDeleteCandidatePhoneResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingDeleteCandidatePhoneTool: InternalToolConfig<
  OracleFusionRecruitingDeleteCandidatePhoneParams,
  OracleFusionRecruitingDeleteCandidatePhoneResponse
> = {
  id: 'oracle_fusion_recruiting_delete_candidate_phone',
  name: 'Delete Candidate Phone',
  description: 'Delete candidate phone.',
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
  outputs: DELETE_CANDIDATE_PHONE_OUTPUTS,
}
