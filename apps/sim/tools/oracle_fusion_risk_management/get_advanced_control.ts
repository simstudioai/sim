import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { ADVANCED_CONTROL_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetAdvancedControlTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_advanced_control',
  outputs: {
    record: {
      type: 'object',
      description: 'advanced control fields',
      properties: ADVANCED_CONTROL_OUTPUT_PROPERTIES,
    },
  },
})
