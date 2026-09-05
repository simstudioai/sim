import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { CONTROL_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementUpdateControlTool = createRiskTool({
  id: 'oracle_fusion_risk_management_update_control',
  outputs: {
    record: {
      type: 'object',
      description: 'control fields',
      properties: CONTROL_OUTPUT_PROPERTIES,
    },
  },
})
