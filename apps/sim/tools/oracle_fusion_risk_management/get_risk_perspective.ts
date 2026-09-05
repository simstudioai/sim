import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { RISK_PERSPECTIVE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetRiskPerspectiveTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_risk_perspective',
  outputs: {
    record: {
      type: 'object',
      description: 'risk perspective fields',
      properties: RISK_PERSPECTIVE_OUTPUT_PROPERTIES,
    },
  },
})
