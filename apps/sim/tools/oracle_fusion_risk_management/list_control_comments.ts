import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  CONTROL_COMMENT_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListControlCommentsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_control_comments',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of control comment records',
      items: { type: 'object', properties: CONTROL_COMMENT_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
