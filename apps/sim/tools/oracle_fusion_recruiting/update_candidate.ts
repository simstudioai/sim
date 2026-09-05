import { credentials, internalExecution } from '@/tools/oracle_fusion_recruiting/common'
import {
  UPDATE_CANDIDATE_OUTPUTS,
  type OracleFusionRecruitingUpdateCandidateParams,
  type OracleFusionRecruitingUpdateCandidateResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingUpdateCandidateTool: InternalToolConfig<
  OracleFusionRecruitingUpdateCandidateParams,
  OracleFusionRecruitingUpdateCandidateResponse
> = {
  id: 'oracle_fusion_recruiting_update_candidate',
  name: 'Update Candidate',
  description: 'Update candidate.',
  ...internalExecution,
  params: {
    ...credentials,
    candidateNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Candidate number; use the identifier returned by the matching list tool',
    },
    body: { type: 'json', required: true, visibility: 'user-or-llm', description: 'Documented Oracle fields: FirstName, LastName, MiddleNames, Email, KnownAs, Title, Suffix, PreNameAdjunct, PreviousLastName, PreferredLanguage, PreferredTimezone, CampaignOptIn, SourceMedium, SourceName. Int64 IDs must be decimal strings.' },
  },
  outputs: UPDATE_CANDIDATE_OUTPUTS,
}
