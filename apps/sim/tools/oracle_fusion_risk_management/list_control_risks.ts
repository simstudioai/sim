import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  CONTROL_RISK_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListControlRisksTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_control_risks',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of control risk records',
      items: { type: 'object', properties: CONTROL_RISK_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
