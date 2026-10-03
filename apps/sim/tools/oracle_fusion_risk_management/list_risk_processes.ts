import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  RISK_PAGINATION_OUTPUTS,
  RISK_PROCESS_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListRiskProcessesTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_risk_processes',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of risk process records',
      items: { type: 'object', properties: RISK_PROCESS_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
