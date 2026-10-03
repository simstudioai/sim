import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { PROCESS_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementUpdateProcessTool = createRiskTool({
  id: 'oracle_fusion_risk_management_update_process',
  outputs: {
    record: {
      type: 'object',
      description: 'process fields',
      properties: PROCESS_OUTPUT_PROPERTIES,
    },
  },
})
