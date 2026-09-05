import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  PROCESS_COMMENT_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListProcessCommentsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_process_comments',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of process comment records',
      items: { type: 'object', properties: PROCESS_COMMENT_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
