import { credentials, internalExecution } from '@/tools/oracle_fusion_recruiting/common'
import {
  CREATE_CANDIDATE_OUTPUTS,
  type OracleFusionRecruitingCreateCandidateParams,
  type OracleFusionRecruitingCreateCandidateResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingCreateCandidateTool: InternalToolConfig<
  OracleFusionRecruitingCreateCandidateParams,
  OracleFusionRecruitingCreateCandidateResponse
> = {
  id: 'oracle_fusion_recruiting_create_candidate',
  name: 'Create Candidate',
  description: 'Create candidate.',
  ...internalExecution,
  params: {
    ...credentials,
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Documented Oracle fields: FirstName, LastName, MiddleNames, Email, KnownAs, Title, Suffix, PreNameAdjunct, PreviousLastName, PreferredLanguage, PreferredTimezone, CampaignOptIn, SourceMedium, SourceName. Int64 IDs must be decimal strings.',
    },
  },
  outputs: CREATE_CANDIDATE_OUTPUTS,
}
