import { credentials, internalExecution } from '@/tools/oracle_fusion_recruiting/common'
import {
  GET_CANDIDATE_OUTPUTS,
  type OracleFusionRecruitingGetCandidateParams,
  type OracleFusionRecruitingGetCandidateResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingGetCandidateTool: InternalToolConfig<
  OracleFusionRecruitingGetCandidateParams,
  OracleFusionRecruitingGetCandidateResponse
> = {
  id: 'oracle_fusion_recruiting_get_candidate',
  name: 'Get Candidate',
  description: 'Get candidate.',
  ...internalExecution,
  params: {
    ...credentials,
    candidateNumber: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Candidate number; use the identifier returned by the matching list tool' },
  },
  outputs: GET_CANDIDATE_OUTPUTS,
}
