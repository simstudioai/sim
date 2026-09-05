import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  RISK_CONTROL_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListRiskControlsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_risk_controls',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of risk control records',
      items: { type: 'object', properties: RISK_CONTROL_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
