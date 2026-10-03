import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import {
  PROCESS_ASSESSMENT_RESULT_OUTPUT_PROPERTIES,
  RISK_PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementListProcessAssessmentResultsTool = createRiskTool({
  id: 'oracle_fusion_risk_management_list_process_assessment_results',
  outputs: {
    items: {
      type: 'array',
      description: 'One page of process assessment result records',
      items: { type: 'object', properties: PROCESS_ASSESSMENT_RESULT_OUTPUT_PROPERTIES },
    },
    ...RISK_PAGINATION_OUTPUTS,
  },
})
