import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  RISK_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListRisksTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_risks',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of risk records',
      items: { type: 'object', properties: RISK_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
