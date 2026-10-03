import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  ASSIGNMENT_GROUP_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListAssignmentGroupsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_assignment_groups',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of assignment group records',
      items: { type: 'object', properties: ASSIGNMENT_GROUP_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
