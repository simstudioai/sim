import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { CONTROL_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetControlTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_control',
  outputs: {
    record: {
      type: 'object',
      description: 'control fields',
      properties: CONTROL_OUTPUT_PROPERTIES,
    },
  },
})
