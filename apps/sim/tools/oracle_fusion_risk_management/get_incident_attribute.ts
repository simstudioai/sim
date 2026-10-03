import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { INCIDENT_ATTRIBUTE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetIncidentAttributeTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_incident_attribute',
  outputs: {
    record: {
      type: 'object',
      description: 'incident attribute fields',
      properties: INCIDENT_ATTRIBUTE_OUTPUT_PROPERTIES,
    },
  },
})
