import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { CONTROL_RISK_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetControlRiskTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_control_risk',
  outputs: {
    record: {
      type: 'object',
      description: 'control risk fields',
      properties: CONTROL_RISK_OUTPUT_PROPERTIES,
    },
  },
})
