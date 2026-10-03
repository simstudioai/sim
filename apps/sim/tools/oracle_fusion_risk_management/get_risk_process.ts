import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { RISK_PROCESS_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetRiskProcessTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_risk_process',
  outputs: {
    record: {
      type: 'object',
      description: 'risk process fields',
      properties: RISK_PROCESS_OUTPUT_PROPERTIES,
    },
  },
})
