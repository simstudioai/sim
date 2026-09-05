import { credentials, internalExecution, page, search } from '@/tools/oracle_fusion_recruiting/common'
import {
  LIST_APPLICATIONS_OUTPUTS,
  type OracleFusionRecruitingListApplicationsParams,
  type OracleFusionRecruitingListApplicationsResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingListApplicationsTool: InternalToolConfig<
  OracleFusionRecruitingListApplicationsParams,
  OracleFusionRecruitingListApplicationsResponse
> = {
  id: 'oracle_fusion_recruiting_list_applications',
  name: 'List Applications',
  description: 'List applications.',
  ...internalExecution,
  params: {
    ...credentials,
    ...page,
    ...search,
    requisitionId: { type: 'string', required: false, visibility: 'user-or-llm', description: 'Filter by requisition ID as a positive decimal string' },
  },
  outputs: LIST_APPLICATIONS_OUTPUTS,
}
