import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { PROCESS_PERSPECTIVE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetProcessPerspectiveTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_process_perspective',
  outputs: {
    record: {
      type: 'object',
      description: 'process perspective fields',
      properties: PROCESS_PERSPECTIVE_OUTPUT_PROPERTIES,
    },
  },
})
