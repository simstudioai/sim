import {
  credentials,
  internalExecution,
  page,
  search,
} from '@/tools/oracle_fusion_recruiting/common'
import {
  LIST_CANDIDATES_OUTPUTS,
  type OracleFusionRecruitingListCandidatesParams,
  type OracleFusionRecruitingListCandidatesResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingListCandidatesTool: InternalToolConfig<
  OracleFusionRecruitingListCandidatesParams,
  OracleFusionRecruitingListCandidatesResponse
> = {
  id: 'oracle_fusion_recruiting_list_candidates',
  name: 'List Candidates',
  description: 'List candidates.',
  ...internalExecution,
  params: {
    ...credentials,
    ...page,
    ...search,
  },
  outputs: LIST_CANDIDATES_OUTPUTS,
}
