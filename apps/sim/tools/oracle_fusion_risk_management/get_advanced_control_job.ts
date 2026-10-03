import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { ADVANCED_CONTROL_JOB_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetAdvancedControlJobTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_advanced_control_job',
  outputs: {
    record: {
      type: 'object',
      description: 'advanced control job fields',
      properties: ADVANCED_CONTROL_JOB_OUTPUT_PROPERTIES,
    },
  },
})
