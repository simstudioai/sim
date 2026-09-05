import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  RISK_ASSESSMENT_RESULT_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListRiskAssessmentResultsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_risk_assessment_results',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of risk assessment result records',
      items: { type: 'object', properties: RISK_ASSESSMENT_RESULT_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
