import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  CONTROL_ASSERTION_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListControlAssertionsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_control_assertions',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of control assertion records',
      items: { type: 'object', properties: CONTROL_ASSERTION_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
