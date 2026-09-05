import { credentials, internalExecution } from '@/tools/oracle_fusion_recruiting/common'
import {
  DELETE_REQUISITION_OUTPUTS,
  type OracleFusionRecruitingDeleteRequisitionParams,
  type OracleFusionRecruitingDeleteRequisitionResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingDeleteRequisitionTool: InternalToolConfig<
  OracleFusionRecruitingDeleteRequisitionParams,
  OracleFusionRecruitingDeleteRequisitionResponse
> = {
  id: 'oracle_fusion_recruiting_delete_requisition',
  name: 'Delete Requisition',
  description: 'Delete requisition.',
  ...internalExecution,
  params: {
    ...credentials,
    requisitionId: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Requisition id; use the identifier returned by the matching list tool' },
  },
  outputs: DELETE_REQUISITION_OUTPUTS,
}
