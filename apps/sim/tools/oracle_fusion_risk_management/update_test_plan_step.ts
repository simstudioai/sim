import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { TEST_PLAN_STEP_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementUpdateTestPlanStepTool = createRiskTool({
  id: 'oracle_fusion_risk_management_update_test_plan_step',
  outputs: {
    record: {
      type: 'object',
      description: 'test plan step fields',
      properties: TEST_PLAN_STEP_OUTPUT_PROPERTIES,
    },
  },
})
