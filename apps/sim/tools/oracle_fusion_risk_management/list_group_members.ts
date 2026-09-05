import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  GROUP_MEMBER_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListGroupMembersTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_group_members',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of group member records',
      items: { type: 'object', properties: GROUP_MEMBER_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
