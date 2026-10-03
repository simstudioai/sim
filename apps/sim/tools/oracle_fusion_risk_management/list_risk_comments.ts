import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  RISK_COMMENT_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListRiskCommentsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_risk_comments',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of risk comment records',
      items: { type: 'object', properties: RISK_COMMENT_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
