import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  INCIDENT_PERSPECTIVE_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListIncidentPerspectivesTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_incident_perspectives',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of incident perspective records',
      items: { type: 'object', properties: INCIDENT_PERSPECTIVE_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
