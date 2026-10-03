import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { SECURABLE_TYPE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetSecurableTypeTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_securable_type',
  outputs: {
    record: {
      type: 'object',
      description: 'securable type fields',
      properties: SECURABLE_TYPE_OUTPUT_PROPERTIES,
    },
  },
})
