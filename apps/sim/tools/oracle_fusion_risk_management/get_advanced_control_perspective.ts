import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { ADVANCED_CONTROL_PERSPECTIVE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetAdvancedControlPerspectiveTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_advanced_control_perspective',
  outputs: {
    record: {
      type: 'object',
      description: 'advanced control perspective fields',
      properties: ADVANCED_CONTROL_PERSPECTIVE_OUTPUT_PROPERTIES,
    },
  },
})
