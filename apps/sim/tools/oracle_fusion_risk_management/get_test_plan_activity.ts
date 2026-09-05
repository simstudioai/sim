import { createRiskTool } from '@/tools/oracle_fusion_risk_management/shared'
import { TEST_PLAN_ACTIVITY_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_risk_management/types'

export const oracleFusionRiskManagementGetTestPlanActivityTool = createRiskTool({
  id: 'oracle_fusion_risk_management_get_test_plan_activity',
  outputs: {
    record: {
      type: 'object',
      description: 'test plan activity fields',
      properties: TEST_PLAN_ACTIVITY_OUTPUT_PROPERTIES,
    },
  },
})
