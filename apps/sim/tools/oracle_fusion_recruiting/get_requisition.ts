import { credentials, internalExecution } from '@/tools/oracle_fusion_recruiting/common'
import {
  GET_REQUISITION_OUTPUTS,
  type OracleFusionRecruitingGetRequisitionParams,
  type OracleFusionRecruitingGetRequisitionResponse,
} from '@/tools/oracle_fusion_recruiting/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionRecruitingGetRequisitionTool: InternalToolConfig<
  OracleFusionRecruitingGetRequisitionParams,
  OracleFusionRecruitingGetRequisitionResponse
> = {
  id: 'oracle_fusion_recruiting_get_requisition',
  name: 'Get Requisition',
  description: 'Get requisition.',
  ...internalExecution,
  params: {
    ...credentials,
    requisitionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Requisition id; use the identifier returned by the matching list tool',
    },
  },
  outputs: GET_REQUISITION_OUTPUTS,
}
