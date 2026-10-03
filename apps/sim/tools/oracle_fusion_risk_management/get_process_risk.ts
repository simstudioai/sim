import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { PROCESS_RISK_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetProcessRiskTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_process_risk',
  outputs: {
    record: {
      type: 'object',
      description: 'process risk fields',
      properties: PROCESS_RISK_OUTPUT_PROPERTIES,
    },
  },
})
