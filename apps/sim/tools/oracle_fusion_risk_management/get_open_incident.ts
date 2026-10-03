import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { OPEN_INCIDENT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetOpenIncidentTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_open_incident',
  outputs: {
    record: {
      type: 'object',
      description: 'open incident fields',
      properties: OPEN_INCIDENT_OUTPUT_PROPERTIES,
    },
  },
})
