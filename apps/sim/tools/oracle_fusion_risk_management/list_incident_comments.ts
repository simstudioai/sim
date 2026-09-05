import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  INCIDENT_COMMENT_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListIncidentCommentsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_incident_comments',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of incident comment records',
      items: { type: 'object', properties: INCIDENT_COMMENT_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
