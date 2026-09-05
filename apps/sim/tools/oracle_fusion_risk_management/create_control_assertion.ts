import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { CONTROL_ASSERTION_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementCreateControlAssertionTool = createRiskTool({
  id: 'oracle_fusion_risk_management_create_control_assertion',
  outputs: {
    record: {
      type: 'object',
      description: 'control assertion fields',
      properties: CONTROL_ASSERTION_OUTPUT_PROPERTIES,
    },
  },
})
