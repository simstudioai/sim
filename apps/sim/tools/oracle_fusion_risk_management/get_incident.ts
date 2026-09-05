import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { INCIDENT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetIncidentTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_incident',
  outputs: {
    record: {
      type: 'object',
      description: 'incident fields',
      properties: INCIDENT_OUTPUT_PROPERTIES,
    },
  },
})
