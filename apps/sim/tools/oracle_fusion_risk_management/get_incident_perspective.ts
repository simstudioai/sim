import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { INCIDENT_PERSPECTIVE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetIncidentPerspectiveTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_incident_perspective',
  outputs: {
    record: {
      type: 'object',
      description: 'incident perspective fields',
      properties: INCIDENT_PERSPECTIVE_OUTPUT_PROPERTIES,
    },
  },
})
