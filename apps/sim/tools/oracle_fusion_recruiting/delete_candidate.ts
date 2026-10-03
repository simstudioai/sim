import { credentials, internalExecution } from '@/tools/oracle_fusion_recruiting/common'
import {
  DELETE_CANDIDATE_OUTPUTS,
  type OracleFusionRecruitingDeleteCandidateParams,
  type OracleFusionRecruitingDeleteCandidateResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingDeleteCandidateTool: InternalToolConfig<
  OracleFusionRecruitingDeleteCandidateParams,
  OracleFusionRecruitingDeleteCandidateResponse
> = {
  id: 'oracle_fusion_recruiting_delete_candidate',
  name: 'Delete Candidate',
  description: 'Delete candidate.',
  ...internalExecution,
  params: {
    ...credentials,
    candidateNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Candidate number; use the identifier returned by the matching list tool',
    },
  },
  outputs: DELETE_CANDIDATE_OUTPUTS,
}
