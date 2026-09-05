import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  GROUP_SECURITY_ASSIGNMENT_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListGroupSecurityAssignmentsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_group_security_assignments',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of group security assignment records',
      items: { type: 'object', properties: GROUP_SECURITY_ASSIGNMENT_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
