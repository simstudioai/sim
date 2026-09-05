import { credentials, internalExecution, page, search } from '@/tools/oracle_fusion_recruiting/common'
import {
  LIST_REQUISITIONS_OUTPUTS,
  type OracleFusionRecruitingListRequisitionsParams,
  type OracleFusionRecruitingListRequisitionsResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingListRequisitionsTool: InternalToolConfig<
  OracleFusionRecruitingListRequisitionsParams,
  OracleFusionRecruitingListRequisitionsResponse
> = {
  id: 'oracle_fusion_recruiting_list_requisitions',
  name: 'List Requisitions',
  description: 'List requisitions.',
  ...internalExecution,
  params: {
    ...credentials,
    ...page,
    ...search,
  },
  outputs: LIST_REQUISITIONS_OUTPUTS,
}
