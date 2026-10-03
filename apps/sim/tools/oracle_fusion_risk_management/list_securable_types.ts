import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  RISK_PAGINATION_OUTPUTS,
  SECURABLE_TYPE_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListSecurableTypesTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_securable_types',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of securable type records',
      items: { type: 'object', properties: SECURABLE_TYPE_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
