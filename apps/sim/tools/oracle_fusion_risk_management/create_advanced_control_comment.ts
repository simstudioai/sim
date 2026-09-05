import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { ADVANCED_CONTROL_COMMENT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementCreateAdvancedControlCommentTool = createRiskTool({
  id: 'oracle_fusion_risk_management_create_advanced_control_comment',
  outputs: {
    record: {
      type: 'object',
      description: 'advanced control comment fields',
      properties: ADVANCED_CONTROL_COMMENT_OUTPUT_PROPERTIES,
    },
  },
})
