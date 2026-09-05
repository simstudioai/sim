import { credentials, internalExecution, page } from '@/tools/oracle_fusion_recruiting/common'
import {
  LIST_CANDIDATE_EDUCATION_OUTPUTS,
  type OracleFusionRecruitingListCandidateEducationParams,
  type OracleFusionRecruitingListCandidateEducationResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingListCandidateEducationTool: InternalToolConfig<
  OracleFusionRecruitingListCandidateEducationParams,
  OracleFusionRecruitingListCandidateEducationResponse
> = {
  id: 'oracle_fusion_recruiting_list_candidate_education',
  name: 'List Candidate Education',
  description: 'List candidate education.',
  ...internalExecution,
  params: {
    ...credentials,
    ...page,
    candidateNumber: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Candidate number; use the identifier returned by the matching list tool' },
  },
  outputs: LIST_CANDIDATE_EDUCATION_OUTPUTS,
}
