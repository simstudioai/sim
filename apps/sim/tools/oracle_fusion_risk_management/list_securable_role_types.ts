import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  RISK_PAGINATION_OUTPUTS,
  SECURABLE_ROLE_TYPE_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListSecurableRoleTypesTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_securable_role_types',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of securable role type records',
      items: { type: 'object', properties: SECURABLE_ROLE_TYPE_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
