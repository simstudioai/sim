import { credentials, internalExecution, page } from '@/tools/oracle_fusion_recruiting/common'
import {
  LIST_CANDIDATE_SKILLS_OUTPUTS,
  type OracleFusionRecruitingListCandidateSkillsParams,
  type OracleFusionRecruitingListCandidateSkillsResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingListCandidateSkillsTool: InternalToolConfig<
  OracleFusionRecruitingListCandidateSkillsParams,
  OracleFusionRecruitingListCandidateSkillsResponse
> = {
  id: 'oracle_fusion_recruiting_list_candidate_skills',
  name: 'List Candidate Skills',
  description: 'List candidate skills.',
  ...internalExecution,
  params: {
    ...credentials,
    ...page,
    candidateNumber: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Candidate number; use the identifier returned by the matching list tool' },
  },
  outputs: LIST_CANDIDATE_SKILLS_OUTPUTS,
}
