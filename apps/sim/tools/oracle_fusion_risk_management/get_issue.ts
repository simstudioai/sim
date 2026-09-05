import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { ISSUE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetIssueTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_issue',
  outputs: {
    record: {
      type: 'object',
      description: 'issue fields',
      properties: ISSUE_OUTPUT_PROPERTIES,
    },
  },
})
