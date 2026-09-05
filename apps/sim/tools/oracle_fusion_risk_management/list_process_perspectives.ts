import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  PROCESS_PERSPECTIVE_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListProcessPerspectivesTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_process_perspectives',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of process perspective records',
      items: { type: 'object', properties: PROCESS_PERSPECTIVE_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
