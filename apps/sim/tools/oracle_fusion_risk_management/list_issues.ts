import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  ISSUE_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListIssuesTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_issues',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of issue records',
      items: { type: 'object', properties: ISSUE_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
