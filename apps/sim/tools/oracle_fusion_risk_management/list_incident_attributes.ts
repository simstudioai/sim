import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  INCIDENT_ATTRIBUTE_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListIncidentAttributesTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_incident_attributes',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of incident attribute records',
      items: { type: 'object', properties: INCIDENT_ATTRIBUTE_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
