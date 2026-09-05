import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { PROCESS_COMMENT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementCreateProcessCommentTool = createRiskTool({
  id: 'oracle_fusion_risk_management_create_process_comment',
  outputs: {
    record: {
      type: 'object',
      description: 'process comment fields',
      properties: PROCESS_COMMENT_OUTPUT_PROPERTIES,
    },
  },
})
