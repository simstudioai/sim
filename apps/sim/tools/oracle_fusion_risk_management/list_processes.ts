import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  PROCESS_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListProcessesTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_processes',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of process records',
      items: { type: 'object', properties: PROCESS_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
