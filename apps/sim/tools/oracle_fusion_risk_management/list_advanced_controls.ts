import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  ADVANCED_CONTROL_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListAdvancedControlsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_advanced_controls',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of advanced control records',
      items: { type: 'object', properties: ADVANCED_CONTROL_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
