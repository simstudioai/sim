import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { RISK_CONTROL_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetRiskControlTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_risk_control',
  outputs: {
    record: {
      type: 'object',
      description: 'risk control fields',
      properties: RISK_CONTROL_OUTPUT_PROPERTIES,
    },
  },
})
