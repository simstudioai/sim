import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { RISK_COMMENT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementCreateRiskCommentTool = createRiskTool({
  id: 'oracle_fusion_risk_management_create_risk_comment',
  outputs: {
    record: {
      type: 'object',
      description: 'risk comment fields',
      properties: RISK_COMMENT_OUTPUT_PROPERTIES,
    },
  },
})
