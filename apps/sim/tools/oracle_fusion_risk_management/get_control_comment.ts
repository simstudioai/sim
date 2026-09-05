import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { CONTROL_COMMENT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetControlCommentTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_control_comment',
  outputs: {
    record: {
      type: 'object',
      description: 'control comment fields',
      properties: CONTROL_COMMENT_OUTPUT_PROPERTIES,
    },
  },
})
