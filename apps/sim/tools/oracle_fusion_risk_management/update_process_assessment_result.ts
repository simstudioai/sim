import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { PROCESS_ASSESSMENT_RESULT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementUpdateProcessAssessmentResultTool = createRiskTool({
  id: 'oracle_fusion_risk_management_update_process_assessment_result',
  outputs: {
    record: {
      type: 'object',
      description: 'process assessment result fields',
      properties: PROCESS_ASSESSMENT_RESULT_OUTPUT_PROPERTIES,
    },
  },
})
