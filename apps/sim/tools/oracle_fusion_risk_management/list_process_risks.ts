import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  PROCESS_RISK_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListProcessRisksTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_process_risks',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of process risk records',
      items: { type: 'object', properties: PROCESS_RISK_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
