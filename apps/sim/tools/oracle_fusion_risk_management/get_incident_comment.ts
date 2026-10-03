import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { INCIDENT_COMMENT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetIncidentCommentTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_incident_comment',
  outputs: {
    record: {
      type: 'object',
      description: 'incident comment fields',
      properties: INCIDENT_COMMENT_OUTPUT_PROPERTIES,
    },
  },
})
