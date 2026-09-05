import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  INCIDENT_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListIncidentsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_incidents',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of incident records',
      items: { type: 'object', properties: INCIDENT_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
