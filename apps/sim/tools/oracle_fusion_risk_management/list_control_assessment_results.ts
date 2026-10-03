import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  CONTROL_ASSESSMENT_RESULT_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListControlAssessmentResultsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_control_assessment_results',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of control assessment result records',
      items: { type: 'object', properties: CONTROL_ASSESSMENT_RESULT_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
