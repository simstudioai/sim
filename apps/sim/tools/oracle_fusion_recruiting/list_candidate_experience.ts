import { credentials, internalExecution, page } from '@/tools/oracle_fusion_recruiting/common'
import {
  LIST_CANDIDATE_EXPERIENCE_OUTPUTS,
  type OracleFusionRecruitingListCandidateExperienceParams,
  type OracleFusionRecruitingListCandidateExperienceResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingListCandidateExperienceTool: InternalToolConfig<
  OracleFusionRecruitingListCandidateExperienceParams,
  OracleFusionRecruitingListCandidateExperienceResponse
> = {
  id: 'oracle_fusion_recruiting_list_candidate_experience',
  name: 'List Candidate Experience',
  description: 'List candidate experience.',
  ...internalExecution,
  params: {
    ...credentials,
    ...page,
    candidateNumber: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Candidate number; use the identifier returned by the matching list tool' },
  },
  outputs: LIST_CANDIDATE_EXPERIENCE_OUTPUTS,
}
