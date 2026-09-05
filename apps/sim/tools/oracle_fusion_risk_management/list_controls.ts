import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  CONTROL_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListControlsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_controls',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of control records',
      items: { type: 'object', properties: CONTROL_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
