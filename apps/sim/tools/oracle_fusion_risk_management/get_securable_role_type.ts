import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { SECURABLE_ROLE_TYPE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetSecurableRoleTypeTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_securable_role_type',
  outputs: {
    record: {
      type: 'object',
      description: 'securable role type fields',
      properties: SECURABLE_ROLE_TYPE_OUTPUT_PROPERTIES,
    },
  },
})
