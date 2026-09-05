import { credentials, internalExecution, page } from '@/tools/oracle_fusion_recruiting/common'
import {
  LIST_CANDIDATE_PHONES_OUTPUTS,
  type OracleFusionRecruitingListCandidatePhonesParams,
  type OracleFusionRecruitingListCandidatePhonesResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingListCandidatePhonesTool: InternalToolConfig<
  OracleFusionRecruitingListCandidatePhonesParams,
  OracleFusionRecruitingListCandidatePhonesResponse
> = {
  id: 'oracle_fusion_recruiting_list_candidate_phones',
  name: 'List Candidate Phones',
  description: 'List candidate phones.',
  ...internalExecution,
  params: {
    ...credentials,
    ...page,
    candidateNumber: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Candidate number; use the identifier returned by the matching list tool' },
  },
  outputs: LIST_CANDIDATE_PHONES_OUTPUTS,
}
