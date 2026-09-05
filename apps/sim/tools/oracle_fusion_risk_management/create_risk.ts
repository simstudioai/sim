import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { RISK_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementCreateRiskTool = createRiskTool({
  id: 'oracle_fusion_risk_management_create_risk',
  outputs: {
    record: {
      type: 'object',
      description: 'risk fields',
      properties: RISK_OUTPUT_PROPERTIES,
    },
  },
})
