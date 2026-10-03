import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { PROCESS_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementCreateProcessTool = createRiskTool({
  id: 'oracle_fusion_risk_management_create_process',
  outputs: {
    record: {
      type: 'object',
      description: 'process fields',
      properties: PROCESS_OUTPUT_PROPERTIES,
    },
  },
})
