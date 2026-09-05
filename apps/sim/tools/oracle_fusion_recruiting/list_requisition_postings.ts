import { credentials, internalExecution, page } from '@/tools/oracle_fusion_recruiting/common'
import {
  LIST_REQUISITION_POSTINGS_OUTPUTS,
  type OracleFusionRecruitingListRequisitionPostingsParams,
  type OracleFusionRecruitingListRequisitionPostingsResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingListRequisitionPostingsTool: InternalToolConfig<
  OracleFusionRecruitingListRequisitionPostingsParams,
  OracleFusionRecruitingListRequisitionPostingsResponse
> = {
  id: 'oracle_fusion_recruiting_list_requisition_postings',
  name: 'List Requisition Postings',
  description: 'List requisition postings.',
  ...internalExecution,
  params: {
    ...credentials,
    ...page,
    requisitionId: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Requisition id; use the identifier returned by the matching list tool' },
  },
  outputs: LIST_REQUISITION_POSTINGS_OUTPUTS,
}
