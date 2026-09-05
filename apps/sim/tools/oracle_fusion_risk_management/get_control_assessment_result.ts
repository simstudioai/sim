import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { CONTROL_ASSESSMENT_RESULT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetControlAssessmentResultTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_control_assessment_result',
  outputs: {
    record: {
      type: 'object',
      description: 'control assessment result fields',
      properties: CONTROL_ASSESSMENT_RESULT_OUTPUT_PROPERTIES,
    },
  },
})
