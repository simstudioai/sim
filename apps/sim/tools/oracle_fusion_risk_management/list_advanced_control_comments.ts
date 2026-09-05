import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  ADVANCED_CONTROL_COMMENT_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListAdvancedControlCommentsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_advanced_control_comments',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of advanced control comment records',
      items: { type: 'object', properties: ADVANCED_CONTROL_COMMENT_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
