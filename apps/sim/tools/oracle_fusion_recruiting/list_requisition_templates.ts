import { credentials, internalExecution, page, search } from '@/tools/oracle_fusion_recruiting/common'
import {
  LIST_REQUISITION_TEMPLATES_OUTPUTS,
  type OracleFusionRecruitingListRequisitionTemplatesParams,
  type OracleFusionRecruitingListRequisitionTemplatesResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingListRequisitionTemplatesTool: InternalToolConfig<
  OracleFusionRecruitingListRequisitionTemplatesParams,
  OracleFusionRecruitingListRequisitionTemplatesResponse
> = {
  id: 'oracle_fusion_recruiting_list_requisition_templates',
  name: 'List Requisition Templates',
  description: 'List requisition templates.',
  ...internalExecution,
  params: {
    ...credentials,
    ...page,
    ...search,
  },
  outputs: LIST_REQUISITION_TEMPLATES_OUTPUTS,
}
