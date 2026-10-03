import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { CONTROL_ASSESSMENT_RESULT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementUpdateControlAssessmentResultTool = createRiskTool({
  id: 'oracle_fusion_risk_management_update_control_assessment_result',
  outputs: {
    record: {
      type: 'object',
      description: 'control assessment result fields',
      properties: CONTROL_ASSESSMENT_RESULT_OUTPUT_PROPERTIES,
    },
  },
})
