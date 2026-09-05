import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  OPEN_INCIDENT_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListOpenIncidentsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_open_incidents',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of open incident records',
      items: { type: 'object', properties: OPEN_INCIDENT_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
