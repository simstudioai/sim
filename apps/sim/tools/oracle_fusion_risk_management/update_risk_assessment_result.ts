import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { RISK_ASSESSMENT_RESULT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementUpdateRiskAssessmentResultTool = createRiskTool({
  id: 'oracle_fusion_risk_management_update_risk_assessment_result',
  outputs: {
    record: {
      type: 'object',
      description: 'risk assessment result fields',
      properties: RISK_ASSESSMENT_RESULT_OUTPUT_PROPERTIES,
    },
  },
})
