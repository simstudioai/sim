import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { CONTROL_PERSPECTIVE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetControlPerspectiveTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_control_perspective',
  outputs: {
    record: {
      type: 'object',
      description: 'control perspective fields',
      properties: CONTROL_PERSPECTIVE_OUTPUT_PROPERTIES,
    },
  },
})
