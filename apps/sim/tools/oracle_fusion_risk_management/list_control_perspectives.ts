import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  CONTROL_PERSPECTIVE_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListControlPerspectivesTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_control_perspectives',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of control perspective records',
      items: { type: 'object', properties: CONTROL_PERSPECTIVE_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
