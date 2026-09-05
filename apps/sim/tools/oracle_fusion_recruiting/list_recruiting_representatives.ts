import { credentials, internalExecution, page, search } from '@/tools/oracle_fusion_recruiting/common'
import {
  LIST_RECRUITING_REPRESENTATIVES_OUTPUTS,
  type OracleFusionRecruitingListRecruitingRepresentativesParams,
  type OracleFusionRecruitingListRecruitingRepresentativesResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingListRecruitingRepresentativesTool: InternalToolConfig<
  OracleFusionRecruitingListRecruitingRepresentativesParams,
  OracleFusionRecruitingListRecruitingRepresentativesResponse
> = {
  id: 'oracle_fusion_recruiting_list_recruiting_representatives',
  name: 'List Recruiting Representatives',
  description: 'List recruiting representatives.',
  ...internalExecution,
  params: {
    ...credentials,
    ...page,
    ...search,
  },
  outputs: LIST_RECRUITING_REPRESENTATIVES_OUTPUTS,
}
