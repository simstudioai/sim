import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  RISK_PAGINATION_OUTPUTS,
  RISK_PERSPECTIVE_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListRiskPerspectivesTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_risk_perspectives',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of risk perspective records',
      items: { type: 'object', properties: RISK_PERSPECTIVE_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
